/**
 * Mine node builder
 * 
 * Handles creation of mining nodes, including grouping blocks by tool
 * requirements and handling block variants.
 */

import {
  BuildContext,
  MineGroupNode,
  MineLeafNode,
  BlockSource
} from '../types';
import {
  createVariantGroup,
  cloneInventoryForBranch
} from './nodeBuilderHelpers';
import {
  filterResourceVariants,
  determineTargetItemsFromBlocks
} from './variantResolver';
import {
  BuildRecipeTreeFn,
  injectToolDependency
} from './dependencyInjector';
import { findBlocksWithSameDrop, findSimilarItems } from '../utils/itemSimilarity';
import { chooseMinimalToolName } from '../../utils/items';

/**
 * Builds mining nodes for an item and adds them to the root node
 */
export function buildMineNodes(
  variantsToUse: string[],
  miningPaths: BlockSource[],
  targetCount: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  root: any,
  context: BuildContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  ctx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  mcData: any,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const mineContext = cloneInventoryForBranch(context);
  
  const canonicalBlockByItem = new Map<string, string>();
  const blockVariantsByCanonical = new Map<string, string[]>();
  
  miningPaths.forEach(path => {
    const blockName = path.block;
    let similar: string[];

    if (context.combineSimilarNodes) {
      const sameDrop = findBlocksWithSameDrop(mcData, blockName);
      if (sameDrop.length > 1) {
        similar = sameDrop;
      } else {
        // findSimilarItems groups items by suffix family (e.g. all *_log variants),
        // which is semantically correct for RECIPE ingredient equivalence but NOT
        // for mine-block equivalence: spruce_log blocks drop spruce_log items, not
        // oak_log. Restrict the similar-block set to blocks that actually drop one
        // of the accepted target items (variantsToUse). Without this filter, a
        // request for `oak_log` would pick up every wood log as an interchangeable
        // mine target and the bot would mine spruce_log while expecting oak_log.
        const rawSimilar = findSimilarItems(mcData, blockName);
        similar = filterBlocksDroppingTargetItems(mcData, rawSimilar, variantsToUse);
        if (similar.length === 0) {
          similar = [blockName];
        }
      }
    } else {
      similar = [blockName];
    }

    if (!blockVariantsByCanonical.has(blockName)) {
      blockVariantsByCanonical.set(blockName, similar);
    }

    similar.forEach(itemName => {
      if (!canonicalBlockByItem.has(itemName)) {
        canonicalBlockByItem.set(itemName, blockName);
      }
    });
  });

  const allFilteredBlocks = new Set<string>();
  for (const miningPath of miningPaths) {
    const filtered = filterResourceVariants(mineContext, 'blocks', [miningPath.block]);
    filtered.forEach(b => allFilteredBlocks.add(b));
  }
  
  const availableMineTargets = determineTargetItemsFromBlocks(
    mcData,
    Array.from(allFilteredBlocks),
    variantsToUse
  );

  // Use 'one_of' mode when multiple target items are available (e.g., cobblestone OR cobbled_deepslate)
  // since they represent different items that satisfy the same requirement
  const groupVariantMode = availableMineTargets.length > 1 ? 'one_of' : 'any_of';

  const mineGroup: MineGroupNode = {
    action: 'mine',
    operator: 'OR',
    variantMode: groupVariantMode,
    what: createVariantGroup(groupVariantMode, availableMineTargets),
    targetItem: createVariantGroup(groupVariantMode, availableMineTargets),
    count: targetCount,
    variants: { mode: groupVariantMode, variants: [] },
    children: { mode: groupVariantMode, variants: [] },
    context: mineContext
  };

  const groupedByTool = groupMiningPathsByTool(miningPaths);
  const mineLeafByCanon = new Map<string, MineLeafNode>();

  for (const [toolKey, pathGroup] of groupedByTool) {
    buildMineLeafNodes(
      toolKey,
      pathGroup,
      availableMineTargets,
      targetCount,
      canonicalBlockByItem,
      blockVariantsByCanonical,
      mineLeafByCanon,
      mineContext,
      ctx,
      mcData,
      buildRecipeTreeFn
    );
  }

  mineLeafByCanon.forEach(leaf => {
    mineGroup.children.variants.push({ value: leaf });
  });

  if (mineGroup.children.variants.length > 0) {
    root.children.variants.push({ value: mineGroup });
  }
}

/**
 * Filter a list of block names down to those that drop at least one of the
 * accepted target items. Used to keep `findSimilarItems`-derived "similar
 * block" sets from pulling in wood-family members that drop a *different*
 * item than the caller asked for.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
function filterBlocksDroppingTargetItems(mcData: any, blockNames: string[], targetItems: string[]): string[] {
  if (targetItems.length === 0) return blockNames;
  const targetSet = new Set(targetItems);
  return blockNames.filter(name => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
    const block = Object.values(mcData.blocks).find((b: any) => b.name === name) as any;
    const drops: number[] | undefined = block?.drops;
    if (!drops || drops.length === 0) return false;
    return drops.some(dropId => {
      const itemName = mcData.items[dropId]?.name;
      return !!itemName && targetSet.has(itemName);
    });
  });
}

/**
 * Groups mining paths by required tool
 */
function groupMiningPathsByTool(miningPaths: BlockSource[]): Map<string, BlockSource[]> {
  const groupedByTool = new Map<string, BlockSource[]>();
  
  for (const miningPath of miningPaths) {
    const requiredTool = miningPath.tool;
    const minimalTool = requiredTool && requiredTool !== 'any'
      ? chooseMinimalToolName(requiredTool.split('/')) || requiredTool.split('/')[0]
      : requiredTool;
    const toolKey = minimalTool || 'any';
    if (!groupedByTool.has(toolKey)) {
      groupedByTool.set(toolKey, []);
    }
    groupedByTool.get(toolKey)!.push(miningPath);
  }
  
  return groupedByTool;
}

/**
 * Determines the variant mode for mining based on what items the blocks drop
 * - If all blocks drop the same item(s), use 'any_of' (e.g., diamond_ore and deepslate_diamond_ore both drop diamond)
 * - If blocks drop different items, use 'one_of' (e.g., oak_log, spruce_log drop different log types)
 * 
 * Note: This should be called with unfiltered target items to preserve semantic meaning even after world pruning.
 */
function determineMineVariantMode(
  targetItems: string[]
): 'one_of' | 'any_of' {
  if (targetItems.length > 1) {
    return 'one_of';
  }
  
  return 'any_of';
}

/**
 * Builds mine leaf nodes for a tool group
 */
function buildMineLeafNodes(
  toolKey: string,
  pathGroup: BlockSource[],
  availableMineTargets: string[],
  targetCount: number,
  canonicalBlockByItem: Map<string, string>,
  blockVariantsByCanonical: Map<string, string[]>,
  mineLeafByCanon: Map<string, MineLeafNode>,
  context: BuildContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  ctx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  mcData: any,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const minimalTool = toolKey === 'any' ? undefined : toolKey;
  const blocks = pathGroup.map(p => p.block);
  const filteredBlocks = filterResourceVariants(context, 'blocks', blocks);
  if (filteredBlocks.length === 0) {
    return;
  }

  const leafTargetItems = determineTargetItemsFromBlocks(
    mcData,
    filteredBlocks,
    availableMineTargets
  );

  const allVariantsForThisGroup: string[] = [];
  blocks.forEach(block => {
    const variants = blockVariantsByCanonical.get(block) || [block];
    variants.forEach(v => {
      if (!allVariantsForThisGroup.includes(v)) {
        allVariantsForThisGroup.push(v);
      }
    });
  });

  const allPossibleTargetItems = new Set<string>();
  for (const blockName of allVariantsForThisGroup) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
    const block = Object.values(mcData.blocks).find((b: any) => b.name === blockName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
    if (block && (block as any).drops) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
      (block as any).drops.forEach((dropId: number) => {
        const itemName = mcData.items[dropId]?.name;
        if (itemName) {
          allPossibleTargetItems.add(itemName);
        }
      });
    }
  }

  const variantMode = determineMineVariantMode(Array.from(allPossibleTargetItems));

  const baseLeaf: MineLeafNode = {
    action: 'mine',
    variantMode,
    what: createVariantGroup(variantMode, filteredBlocks),
    targetItem: createVariantGroup(variantMode, leafTargetItems),
    count: targetCount,
    ...(minimalTool ? { tool: createVariantGroup('any_of', [minimalTool]) } : {}),
    variants: { mode: variantMode, variants: [] },
    children: { mode: variantMode, variants: [] },
    context
  };

  if (minimalTool) {
    injectToolDependency(baseLeaf, minimalTool, context, ctx, buildRecipeTreeFn);
  }

  // When multiple target items are acceptable (e.g., cobblestone OR cobbled_deepslate for furnace),
  // create a single mine node with all blocks as 'one_of' variants, rather than splitting by canonical
  const shouldCombineAllBlocks = availableMineTargets.length > 1;

  if (shouldCombineAllBlocks) {
    // Use one mine node with all blocks that can provide any of the acceptable target items
    // Update the variant mode to 'one_of' since we have multiple different target items
    const combinedLeaf: MineLeafNode = {
      ...baseLeaf,
      variantMode: 'one_of',
      what: createVariantGroup('one_of', filteredBlocks),
      targetItem: createVariantGroup('one_of', leafTargetItems),
      variants: { mode: 'one_of', variants: [] },
      children: {
        mode: 'one_of',
        variants: baseLeaf.children.variants.map(child => ({ value: child.value }))
      }
    };
    
    const canonKey = 'combined_' + availableMineTargets.join('_');
    if (!mineLeafByCanon.has(canonKey)) {
      mineLeafByCanon.set(canonKey, combinedLeaf);
    }
  } else if (context.combineSimilarNodes) {
    // Original logic: split by canonical block when only one target item
    const seenCanonical = new Set<string>();
    for (const blockName of filteredBlocks) {
      const canonicalBlock = canonicalBlockByItem.get(blockName) || blockName;
      if (!seenCanonical.has(canonicalBlock)) {
        seenCanonical.add(canonicalBlock);
        const canonKey = canonicalBlock;
        if (!mineLeafByCanon.has(canonKey)) {
          const blockVariants = blockVariantsByCanonical.get(canonicalBlock) || [canonicalBlock];
          const filteredVariants = filterResourceVariants(context, 'blocks', blockVariants);
          if (filteredVariants.length === 0) {
            continue;
          }

          const variantTargetItems = determineTargetItemsFromBlocks(
            mcData,
            filteredVariants,
            availableMineTargets
          );

          const allPossibleVariantTargetItems = new Set<string>();
          for (const blockName of blockVariants) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
            const block = Object.values(mcData.blocks).find((b: any) => b.name === blockName);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
            if (block && (block as any).drops) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
              (block as any).drops.forEach((dropId: number) => {
                const itemName = mcData.items[dropId]?.name;
                if (itemName) {
                  allPossibleVariantTargetItems.add(itemName);
                }
              });
            }
          }

          const variantMode = determineMineVariantMode(Array.from(allPossibleVariantTargetItems));

          const leaf: MineLeafNode = {
            ...baseLeaf,
            variantMode,
            what: createVariantGroup(variantMode, filteredVariants),
            targetItem: createVariantGroup(variantMode, variantTargetItems),
            variants: { mode: variantMode, variants: [] },
            children: {
              mode: variantMode,
              variants: baseLeaf.children.variants.map(child => ({ value: child.value }))
            }
          };

          mineLeafByCanon.set(canonKey, leaf);
        }
      }
    }
  } else {
    const canonKey = filteredBlocks[0];
    if (!mineLeafByCanon.has(canonKey)) {
      mineLeafByCanon.set(canonKey, baseLeaf);
    }
  }
}

