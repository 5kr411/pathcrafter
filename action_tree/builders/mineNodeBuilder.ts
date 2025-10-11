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
import { findSimilarItems, findBlocksWithSameDrop } from '../utils/itemSimilarity';

/**
 * Builds mining nodes for an item and adds them to the root node
 */
export function buildMineNodes(
  variantsToUse: string[],
  miningPaths: BlockSource[],
  targetCount: number,
  root: any,
  context: BuildContext,
  ctx: any,
  mcData: any,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const mineContext = cloneInventoryForBranch(context);
  
  const canonicalBlockByItem = new Map<string, string>();
  const blockVariantsByCanonical = new Map<string, string[]>();
  
  miningPaths.forEach(path => {
    const blockName = path.block;
    const sameDrop = context.combineSimilarNodes ? findBlocksWithSameDrop(mcData, blockName) : [blockName];
    const sameFamily = context.combineSimilarNodes ? findSimilarItems(mcData, blockName) : [blockName];
    const similar = sameDrop.length > sameFamily.length ? sameDrop : sameFamily;
    
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

  const mineGroup: MineGroupNode = {
    action: 'mine',
    operator: 'OR',
    variantMode: 'any_of',
    what: createVariantGroup('any_of', availableMineTargets),
    targetItem: createVariantGroup('any_of', availableMineTargets),
    count: targetCount,
    variants: { mode: 'any_of', variants: [] },
    children: { mode: 'any_of', variants: [] },
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
 * Groups mining paths by required tool
 */
function groupMiningPathsByTool(miningPaths: BlockSource[]): Map<string, BlockSource[]> {
  const groupedByTool = new Map<string, BlockSource[]>();
  
  for (const miningPath of miningPaths) {
    const requiredTool = miningPath.tool;
    const minimalTool = requiredTool && requiredTool !== 'any' ? requiredTool.split('/')[0] : requiredTool;
    const toolKey = minimalTool || 'any';
    if (!groupedByTool.has(toolKey)) {
      groupedByTool.set(toolKey, []);
    }
    groupedByTool.get(toolKey)!.push(miningPath);
  }
  
  return groupedByTool;
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
  ctx: any,
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

  const baseLeaf: MineLeafNode = {
    action: 'mine',
    variantMode: 'any_of',
    what: createVariantGroup('any_of', filteredBlocks),
    targetItem: createVariantGroup('any_of', leafTargetItems),
    count: targetCount,
    ...(minimalTool ? { tool: createVariantGroup('any_of', [minimalTool]) } : {}),
    variants: { mode: 'any_of', variants: [] },
    children: { mode: 'any_of', variants: [] },
    context
  };

  if (minimalTool) {
    injectToolDependency(baseLeaf, minimalTool, context, ctx, buildRecipeTreeFn);
  }

  if (context.combineSimilarNodes) {
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

          const leaf: MineLeafNode = {
            ...baseLeaf,
            what: createVariantGroup('any_of', filteredVariants),
            targetItem: createVariantGroup('any_of', variantTargetItems)
          };

          leaf.children = {
            mode: baseLeaf.children.mode,
            variants: baseLeaf.children.variants.map(child => ({ value: child.value }))
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

