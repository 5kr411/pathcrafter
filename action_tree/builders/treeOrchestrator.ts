/**
 * Tree orchestrator
 * 
 * Handles the main orchestration logic for recipe tree construction.
 * This includes the main buildRecipeTree function and internal orchestration.
 */

import { RootNode, BuildContext } from '../types';
import { resolveMcData } from '../utils/mcDataResolver';
import { findSimilarItems } from '../utils/itemSimilarity';
import { createInventoryMap } from './inventoryManager';
import { filterVariantsByWorldAvailability, fixCraftNodePrimaryFields, normalizePersistentRequires } from './variantHandler';
import { buildCraftNode } from './craftNodeBuilder';
import { buildMineGroupNode } from './mineNodeBuilder';
import { buildSmeltGroupNode } from './smeltNodeBuilder';
import { buildHuntGroupNodeForItem } from './huntNodeBuilder';
import { dedupeRecipesForItem, getIngredientCounts, findFurnaceSmeltsForItem } from '../utils/recipeUtils';
import { findBlocksThatDrop } from '../utils/sourceLookup';

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
  context: BuildContext = {}
): RootNode {
  const mcData = resolveMcData(ctx);
  
  // Always find all similar items (wood families, etc.)
  // This allows exploring all recipe variants for tie-breaking
  let itemGroup: string[];
  if (mcData) {
    itemGroup = findSimilarItems(mcData, itemName);
  } else {
    itemGroup = [itemName];
  }
  
  // Build for the group
  // When combining is enabled, recipes are grouped and shown with variants
  // When combining is disabled, each recipe becomes a separate branch
  return buildRecipeTreeInternal(ctx, itemGroup, targetCount, context);
}

/**
 * Internal function that builds a recipe tree for a group of similar items
 * 
 * @param ctx - Minecraft data context
 * @param itemGroup - Group of similar items to build tree for
 * @param targetCount - Number of items needed
 * @param context - Build context with configuration
 * @returns Root node of the recipe tree
 */
function buildRecipeTreeInternal(
  ctx: any,
  itemGroup: string[],
  targetCount: number,
  context: BuildContext
): RootNode {
  const mcData = resolveMcData(ctx);
  if (!mcData) {
    throw new Error('Could not resolve Minecraft data');
  }

  const primaryItem = itemGroup[0];
  const invMap = createInventoryMap(context);
  const worldBudget = context.worldBudget;

  // Deduct from inventory if available (check all items in group)
  if (invMap && invMap.size > 0 && targetCount > 0) {
    for (const name of itemGroup) {
      const have = invMap.get(name) || 0;
      if (have > 0) {
        const use = Math.min(have, targetCount);
        targetCount = Math.max(0, targetCount - use);
        invMap.set(name, have - use);
      }
    }
  }

  // If we have enough items, return a simple root node
  if (targetCount <= 0) {
    return {
      action: 'root',
      operator: 'OR',
      what: primaryItem,
      count: 0,
      children: []
    };
  }

  const root: RootNode = {
    action: 'root',
    operator: 'OR',
    what: primaryItem,
    count: targetCount,
    children: []
  };

  const visited = new Set<string>();
  const nextVisited = new Set(visited);
  nextVisited.add(primaryItem);

  // Process crafting recipes for all items in the group
  const allRecipes: Array<{ recipe: any, itemName: string, itemId: number }> = [];
  
  for (const itemName of itemGroup) {
    const itemId = mcData.itemsByName[itemName]?.id;
    if (!itemId) continue;

    const recipes = dedupeRecipesForItem(mcData, itemId, context.combineSimilarNodes);
    for (const recipe of recipes) {
      allRecipes.push({ recipe, itemName, itemId });
    }
  }

  // Group recipes by canonical shape (when combining is enabled)
  let recipeGroups: Array<Array<{ recipe: any, itemName: string, itemId: number }>>;
  if (context.combineSimilarNodes) {
    const groupsByShape = new Map<string, Array<{ recipe: any, itemName: string, itemId: number }>>();
    
    for (const recipeEntry of allRecipes) {
      const shapeKey = JSON.stringify(
        Array.from(getIngredientCounts(recipeEntry.recipe).keys())
          .map((id: number) => mcData.items[id]?.name)
          .sort()
      );
      
      if (!groupsByShape.has(shapeKey)) {
        groupsByShape.set(shapeKey, []);
      }
      groupsByShape.get(shapeKey)!.push(recipeEntry);
    }
    
    recipeGroups = Array.from(groupsByShape.values());
  } else {
    recipeGroups = allRecipes.map(recipe => [recipe]);
  }

  // Process each recipe group
  for (const recipeGroup of recipeGroups) {
    const craftNode = buildCraftNode(mcData, recipeGroup, targetCount, invMap, context, nextVisited, buildRecipeTreeInternal as any);
    if (craftNode) {
      root.children.push(craftNode);
    }
  }

  // Process smelting recipes (only for primary item, not all variants)
  const smeltInputs = findFurnaceSmeltsForItem(mcData, primaryItem);
  if (smeltInputs.length > 0) {
    const smeltGroup = buildSmeltGroupNode(
      mcData, 
      primaryItem, 
      targetCount, 
      smeltInputs, 
      invMap, 
      context, 
      worldBudget, 
      nextVisited,
      buildRecipeTreeInternal as any
    );
    if (smeltGroup) {
      root.children.push(smeltGroup);
    }
  }

  // Process mining paths (only for primary item, not all variants)
  const miningPaths = findBlocksThatDrop(mcData, primaryItem);
  if (miningPaths.length > 0) {
    // Group mining paths by tool and target
    const groupedPaths = new Map<string, Array<{block: string, tool: string, _blockVariants?: string[], _targetVariants?: string[]}>>();
    
    for (const path of miningPaths) {
      const key = `${path.tool}:${primaryItem}`;
      if (!groupedPaths.has(key)) {
        groupedPaths.set(key, []);
      }
      groupedPaths.get(key)!.push({
        ...path,
        _blockVariants: miningPaths.map(p => p.block),
        _targetVariants: [primaryItem]
      });
    }

    for (const [_key, paths] of groupedPaths) {
      const mineGroup = buildMineGroupNode(mcData, primaryItem, targetCount, paths, invMap, context, worldBudget);
      if (mineGroup) {
        root.children.push(mineGroup);
      }
    }
  }

  // Process hunting paths (only for primary item, not all variants)
  const huntGroup = buildHuntGroupNodeForItem(mcData, primaryItem, targetCount, worldBudget);
  if (huntGroup) {
    root.children.push(huntGroup);
  }

  // Normalize persistent requirements
  try {
    normalizePersistentRequires(root, context && context.inventory ? context.inventory : null);
  } catch (_) {
    // Ignore normalization errors
  }

  // Filter variants based on world availability if enabled
  if (context && context.combineSimilarNodes && worldBudget) {
    try {
      filterVariantsByWorldAvailability(root, worldBudget);
      // After filtering, fix craft nodes to use available variants as primary
      fixCraftNodePrimaryFields(root, worldBudget);
    } catch (_) {
      // Ignore filtering errors
    }
  }

  return root;
}

/**
 * Sets up the buildRecipeTreeInternal reference for circular dependency resolution
 * This is needed because craftNodeBuilder needs to call back to the main orchestrator
 */
export function setupCircularDependencyResolution(): void {
  // This function will be called during initialization to set up the circular dependency
  // The actual implementation would involve passing the buildRecipeTreeInternal function
  // to the craftNodeBuilder module
}
