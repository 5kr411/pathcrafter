/**
 * Tree orchestrator
 * 
 * Main orchestration logic for recipe tree construction.
 * Delegates to specialized node builders for each action type.
 */

import { 
  RootNode, 
  BuildContext, 
  VariantGroup,
  VariantConstraintManager
} from '../types';
import { resolveMcData } from '../utils/mcDataResolver';
import { findSameFamilyItems } from '../utils/itemSimilarity';
import { findFurnaceSmeltsForItem } from '../utils/recipeUtils';
import { findBlocksThatDrop, findMobsThatDrop } from '../utils/sourceLookup';
import { resolveVariantsForItem, createVariantGroupWithMetadata } from './variantResolver';
import { buildCraftNodes } from './craftNodeBuilder';
import { buildMineNodes } from './mineNodeBuilder';
import { buildSmeltNodes } from './smeltNodeBuilder';
import { buildHuntNodes } from './huntNodeBuilder';
import { applyPostBuildFiltering } from './postBuildFilter';

/**
 * Main function to build a recipe tree for obtaining a target item
 * 
 * @param ctx - Minecraft data context (version string, mcData object, etc.)
 * @param itemName - Name of the item to obtain
 * @param targetCount - Number of items needed (default: 1)
 * @param context - Build context with configuration
 * @returns Root node of the recipe tree
 */
export function buildRecipeTree(
  ctx: any,
  itemName: string,
  targetCount: number = 1,
  context: Partial<BuildContext> = {}
): RootNode {
  
  const mcData = resolveMcData(ctx);
  
  if (!mcData) {
    throw new Error('Could not resolve Minecraft data');
  }
  
  const itemGroup = context.combineSimilarNodes ? findSameFamilyItems(mcData, itemName) : [itemName];
  
  // Clone inventory to prevent mutation of caller's inventory
  const inventoryCopy = context.inventory ? new Map(context.inventory) : new Map();
  
  const variantContext: BuildContext = {
    inventory: inventoryCopy,
    worldBudget: context.worldBudget,
    pruneWithWorld: context.pruneWithWorld,
    visited: context.visited || new Set(),
    depth: context.depth || 0,
    parentPath: context.parentPath || [],
    config: {
      preferMinimalTools: context.config?.preferMinimalTools ?? true,
      avoidTool: context.config?.avoidTool,
      maxDepth: context.config?.maxDepth ?? 10
    },
    variantConstraints: context.variantConstraints || new VariantConstraintManager(),
    combineSimilarNodes: context.combineSimilarNodes
  };
  
  const tree = buildRecipeTreeInternal(ctx, itemGroup, targetCount, variantContext);
  
  // Apply post-build filtering to remove craft variants with unavailable ingredients
  applyPostBuildFiltering(tree, variantContext, mcData);
  
  return tree;
}

/**
 * Internal function that builds a recipe tree for a group of similar items
 */
function buildRecipeTreeInternal(
  ctx: any,
  itemGroup: string[],
  targetCount: number,
  context: BuildContext
): RootNode {
  const mcData = resolveMcData(ctx);
  
  const { variantsToUse, variantMode } = resolveVariantsForItem(itemGroup, context);
  const primaryItem = variantsToUse[0];
  const item = mcData?.itemsByName[primaryItem];
  const invMap = context.inventory;

  // For persistent items, preserve the inventory counts for tool availability checking
  const { isPersistentItem } = require('../../utils/persistentItemsConfig');
  const persistentItemCounts = new Map<string, number>();
  if (invMap) {
    for (const name of variantsToUse) {
      if (isPersistentItem(name)) {
        const count = invMap.get(name) || 0;
        if (count > 0) {
          persistentItemCounts.set(name, count);
        }
      }
    }
  }

  targetCount = deductFromInventory(invMap, variantsToUse, targetCount);

  // Restore persistent item counts so they remain available for tool checks
  if (invMap && persistentItemCounts.size > 0) {
    for (const [name, count] of persistentItemCounts.entries()) {
      invMap.set(name, count);
    }
  }

  const whatVariants: VariantGroup<string> = createVariantGroupWithMetadata(
    variantMode,
    variantsToUse,
    name => name
  );

  const root: RootNode = {
    action: 'root',
    operator: 'OR',
    variantMode,
    what: whatVariants,
    count: targetCount,
    variants: { mode: variantMode, variants: [] },
    children: { mode: variantMode, variants: [] },
    context
  };

  if (!mcData || !item || targetCount <= 0) {
    return root;
  }

  const visited = context.visited;
  const anyVisited = variantsToUse.some(name => visited.has(name));
  if (anyVisited) {
    return root;
  }

  const nextVisited = new Set(visited);
  for (const name of variantsToUse) {
    nextVisited.add(name);
  }

  buildCraftNodes(
    variantsToUse,
    variantMode,
    primaryItem,
    targetCount,
    root,
    context,
    ctx,
    mcData,
    nextVisited,
    buildRecipeTreeInternal
  );

  const smeltInputs = findFurnaceSmeltsForItem(mcData, primaryItem);
  if (smeltInputs.length > 0) {
    buildSmeltNodes(
      primaryItem,
      smeltInputs,
      targetCount,
      root,
      context,
      ctx,
      buildRecipeTreeInternal
    );
  }

  const allMiningPaths: any[] = [];
  const seenBlocks = new Set<string>();
  for (const variant of variantsToUse) {
    const paths = findBlocksThatDrop(mcData, variant);
    for (const path of paths) {
      if (!seenBlocks.has(path.block)) {
        seenBlocks.add(path.block);
        allMiningPaths.push(path);
      }
    }
  }
  if (allMiningPaths.length > 0) {
    buildMineNodes(
      variantsToUse,
      allMiningPaths,
      targetCount,
      root,
      context,
      ctx,
      mcData,
      buildRecipeTreeInternal
    );
  }

  const huntingPaths = findMobsThatDrop(mcData, primaryItem);
  if (huntingPaths.length > 0) {
    buildHuntNodes(
      variantsToUse,
      huntingPaths,
      targetCount,
      root,
      context,
      mcData
    );
  }

  return root;
}

/**
 * Deducts items from inventory across all variants
 */
function deductFromInventory(
  invMap: Map<string, number> | undefined,
  variantsToUse: string[],
  targetCount: number
): number {
  if (!invMap || invMap.size === 0 || targetCount <= 0) {
    return targetCount;
  }

  for (const name of variantsToUse) {
    const have = invMap.get(name) || 0;
    if (have > 0) {
      const use = Math.min(have, targetCount);
      invMap.set(name, have - use);
      targetCount -= use;
      if (targetCount <= 0) break;
    }
  }

  return targetCount;
}
