/**
 * Tree orchestrator
 * 
 * Handles the main orchestration logic for recipe tree construction.
 * Refactored to use variant-first approach with VariantConstraintManager.
 */

import { 
  RootNode, 
  BuildContext, 
  CraftNode, 
  MineGroupNode, 
  MineLeafNode,
  SmeltGroupNode, 
  SmeltNode,
  HuntGroupNode,
  HuntLeafNode,
  MinecraftRecipe,
  VariantGroup,
  VariantConstraintManager,
  ItemReference,
  BlockSource
} from '../types';
import { resolveMcData } from '../utils/mcDataResolver';
import { findSameFamilyItems, findSimilarItems, findBlocksWithSameDrop } from '../utils/itemSimilarity';
import { getIngredientCounts, findFurnaceSmeltsForItem, requiresCraftingTable, getRecipeCanonicalKey } from '../utils/recipeUtils';
import { findBlocksThatDrop, findMobsThatDrop } from '../utils/sourceLookup';
import { getSuffixTokenFromName } from '../../utils/items';
import { canConsumeWorld, ResourceKind } from '../../utils/worldBudget';

/**
 * Helper functions for variant-first system
 */
function getFamilyFromName(name: string): string | undefined {
  const parts = name.split('_');
  return parts.length > 1 ? parts[0] : undefined;
}

function getSuffixFromName(name: string): string | undefined {
  const parts = name.split('_');
  return parts.length > 1 ? parts.slice(1).join('_') : undefined;
}

function createVariantGroup<T>(mode: 'one_of' | 'any_of', values: T[]): VariantGroup<T> {
  return {
    mode,
    variants: values.map(value => ({ value }))
  };
}

function isWorldPruningEnabled(context: BuildContext): boolean {
  return Boolean(context.pruneWithWorld && context.worldBudget);
}

function filterResourceVariants(
  context: BuildContext,
  kind: ResourceKind,
  variants: string[]
): string[] {
  const unique = Array.from(new Set(variants));
  if (!isWorldPruningEnabled(context)) {
    return unique;
  }

  const worldBudget = context.worldBudget!;
  const filtered = unique.filter(name => canConsumeWorld(worldBudget, kind, name, 1));
  if (filtered.length === 0) {
    return [];
  }

  return filtered;
}

/**
 * Creates a dependency tree for workstation dependencies
 */
function createWorkstationDependencyTree(itemName: string, context: BuildContext, ctx: any): RootNode {
  // Create a new context for the dependency tree
  const depContext: BuildContext = {
    ...context,
    depth: context.depth + 1,
    parentPath: [...context.parentPath, itemName]
  };
  
  // Build the full tree to acquire the workstation
  return buildRecipeTreeInternal(ctx, [itemName], 1, depContext);
}

/**
 * Creates a dependency tree for tool dependencies
 */
function createToolDependencyTree(toolName: string, context: BuildContext, ctx: any): RootNode {
  // Create a new context for the dependency tree
  const depContext: BuildContext = {
    ...context,
    depth: context.depth + 1,
    parentPath: [...context.parentPath, toolName]
  };
  
  // Build the full tree to acquire the tool
  return buildRecipeTreeInternal(ctx, [toolName], 1, depContext);
}

/**
 * Checks if a workstation dependency is already satisfied in the tree
 */
function hasWorkstationDependency(node: any, workstationName: string): boolean {
  if (!node || !node.children || !node.children.variants) return false;
  
  return node.children.variants.some((child: any) => {
    const childNode = child.value;
    if (childNode && childNode.action === 'root' && 
        childNode.what && childNode.what.variants[0] && 
        childNode.what.variants[0].value === workstationName) {
      return true;
    }
    return hasWorkstationDependency(childNode, workstationName);
  });
}

/**
 * Checks if a tool dependency is already satisfied in the tree
 */
function hasToolDependency(node: any, toolName: string): boolean {
  if (!node || !node.children || !node.children.variants) return false;
  
  return node.children.variants.some((child: any) => {
    const childNode = child.value;
    if (childNode && childNode.action === 'root' && 
        childNode.what && childNode.what.variants[0] && 
        childNode.what.variants[0].value === toolName) {
      return true;
    }
    return hasToolDependency(childNode, toolName);
  });
}


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
  
  // For the root target, only find items within the same family (e.g., oak_planks -> only oak variants)
  // This ensures that asking for oak_planks doesn't return spruce/birch as options
  const itemGroup = context.combineSimilarNodes ? findSameFamilyItems(mcData, itemName) : [itemName];
  
  // Create variant-first context
  const variantContext: BuildContext = {
    inventory: context.inventory || new Map(),
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
  
  return buildRecipeTreeInternal(ctx, itemGroup, targetCount, variantContext);
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
  
  // Check variant constraints
  const constraintManager = context.variantConstraints;
  const requiredVariant = constraintManager.getRequiredVariant(itemGroup[0]);
  const allowedVariants = constraintManager.getAllowedVariants(itemGroup[0]);
  
  let variantsToUse: string[];
  let variantMode: 'one_of' | 'any_of';
  
  if (requiredVariant) {
    // Must use specific variant due to upstream constraint
    variantsToUse = [requiredVariant];
    variantMode = 'one_of';
  } else if (allowedVariants.length > 0) {
    // Use allowed variants
    variantsToUse = allowedVariants;
    variantMode = 'any_of';
  } else {
    // No constraints - use all similar items
    variantsToUse = itemGroup;
    variantMode = 'one_of'; // Default to one_of for crafting
  }
  
  const primaryItem = variantsToUse[0];
  const item = mcData?.itemsByName[primaryItem];
  const invMap = context.inventory;

  // Deduct from inventory if available (check all variants)
  if (invMap && invMap.size > 0 && targetCount > 0) {
    for (const name of variantsToUse) {
      const have = invMap.get(name) || 0;
      if (have > 0) {
        const use = Math.min(have, targetCount);
        invMap.set(name, have - use);
        targetCount -= use;
        if (targetCount <= 0) break;
      }
    }
  }

  // Create variant group for root node
  const whatVariants: VariantGroup<string> = {
    mode: variantMode,
    variants: variantsToUse.map(name => ({
      value: name,
      metadata: {
        family: getFamilyFromName(name),
        suffix: getSuffixFromName(name)
      }
    }))
  };

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

  if (!mcData || !item) return root;
  if (targetCount <= 0) return root;

  const visited = context.visited;

  // Check if any variant has been visited
  const anyVisited = variantsToUse.some(name => visited.has(name));
  if (anyVisited) return root;

  const nextVisited = new Set(visited);
  for (const name of variantsToUse) {
    nextVisited.add(name);
  }

  // Helper function to create a craft node for a recipe group
  function createCraftNodeForGroup(
    recipeGroup: Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}>,
    craftingsNeeded: number,
    variantMode: 'one_of' | 'any_of',
    parentNode: RootNode,
    context: BuildContext,
    mcData: any,
    visited: Set<string>,
    ctx: any
  ) {
    const recipe = recipeGroup[0].recipe;
    
    const whatVariants: VariantGroup<'table' | 'inventory'> = createVariantGroup(
      'one_of',
      [requiresCraftingTable(recipe) ? 'table' : 'inventory']
    );

    const resultVariants: VariantGroup<ItemReference> = {
      mode: context.combineSimilarNodes ? variantMode : 'one_of',
      variants: context.combineSimilarNodes 
        ? recipeGroup.map(entry => ({
            value: {
              item: entry.itemName,
              perCraftCount: recipe.result.count
            },
            metadata: {
              family: getFamilyFromName(entry.itemName),
              suffix: getSuffixFromName(entry.itemName)
            }
          }))
        : [{
            value: {
              item: recipeGroup[0].itemName,
              perCraftCount: recipe.result.count
            },
            metadata: {
              family: getFamilyFromName(recipeGroup[0].itemName),
              suffix: getSuffixFromName(recipeGroup[0].itemName)
            }
          }]
    };

    const ingredientVariants: VariantGroup<ItemReference[]> = {
      mode: context.combineSimilarNodes ? variantMode : 'one_of',
      variants: context.combineSimilarNodes 
        ? recipeGroup.map(entry => {
            const counts = getIngredientCounts(entry.recipe);
            return {
              value: Array.from(counts.entries())
                .sort(([a], [b]) => a - b)
                .map(([id, count]) => {
                  const ingName = mcData.items[id]?.name;
                  return {
                    item: ingName,
                    perCraftCount: count
                  };
                }),
              metadata: {
                family: getFamilyFromName(entry.itemName),
                suffix: getSuffixFromName(entry.itemName)
              }
            };
          })
        : [{
            value: Array.from(getIngredientCounts(recipeGroup[0].recipe).entries())
              .sort(([a], [b]) => a - b)
              .map(([id, count]) => {
                const ingName = mcData.items[id]?.name;
                return {
                  item: ingName,
                  perCraftCount: count
                };
              }),
            metadata: {
              family: getFamilyFromName(recipeGroup[0].itemName),
              suffix: getSuffixFromName(recipeGroup[0].itemName)
            }
          }]
    };

    const craftNode: CraftNode = {
      action: 'craft',
      operator: 'AND',
      variantMode,
      what: whatVariants,
      count: craftingsNeeded,
      result: resultVariants,
      ingredients: ingredientVariants,
      variants: { mode: variantMode, variants: [] },
      children: { mode: variantMode, variants: [] },
      context
    };

    if (variantMode === 'one_of') {
      constraintManager.addConstraint(primaryItem, {
        type: 'one_of',
        availableVariants: variantsToUse,
        constraintPath: context.parentPath
      });
    }

    if (requiresCraftingTable(recipe) && !hasWorkstationDependency(craftNode, 'crafting_table')) {
      const craftingTableTree = createWorkstationDependencyTree('crafting_table', context, ctx);
      craftNode.children.variants.push({ value: craftingTableTree });
    }

    // Process ingredients (simplified version for specific recipe group)
    const representativeVariant = ingredientVariants.variants[0];
    if (representativeVariant) {
      const ingredients = representativeVariant.value || [];
      for (const ingredient of ingredients) {
        if (!ingredient?.item) continue;
        const perCraft = ingredient.perCraftCount || 1;
        const requiredCount = perCraft * craftingsNeeded;
        const similarItems = context.combineSimilarNodes
          ? Array.from(new Set(findSimilarItems(mcData, ingredient.item)))
          : [ingredient.item];
        if (similarItems.length === 0) continue;
        
        const ingredientContext: BuildContext = {
          ...context,
          visited,
          depth: context.depth + 1,
          parentPath: [...context.parentPath, ingredient.item],
          variantConstraints: constraintManager.clone()
        };

        const ingredientTree = buildRecipeTreeInternal(ctx, similarItems, requiredCount, ingredientContext);
        craftNode.children.variants.push({ value: ingredientTree });
      }
    }

    parentNode.children.variants.push({ value: craftNode });
  }

  // Collect all recipes for all variants
  const allRecipes: Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}> = [];
  for (const name of variantsToUse) {
    const itemData = mcData.itemsByName[name];
    if (itemData) {
      const rawRecipes = mcData.recipes[itemData.id] || [];
      for (const recipe of rawRecipes) {
        allRecipes.push({recipe, itemName: name, itemId: itemData.id});
      }
    }
  }

  // Group recipes by canonical shape (same structure)
  // All recipes with the same shape will be combined, with ingredient alternatives as OR branches
  const recipeGroups = new Map<string, Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}>>();
  for (const entry of allRecipes) {
    const key = context.combineSimilarNodes ? getRecipeCanonicalKey(entry.recipe) : entry.itemName;
    
    if (!recipeGroups.has(key)) {
      recipeGroups.set(key, []);
    }
    recipeGroups.get(key)!.push(entry);
  }


  // Process crafting recipe groups (each group represents recipes with same shape across variants)
  for (const [_canonicalKey, recipeGroup] of recipeGroups.entries()) {
    // Use first recipe as representative
    const recipe = recipeGroup[0].recipe;
    const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
    
    // Group recipes by ingredient suffix to identify alternatives
    // (oak_log recipes vs oak_wood recipes are alternatives, not cumulative)
    const recipeBySuffix = new Map<string, Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}>>();
    for (const entry of recipeGroup) {
      const ingredientCounts = getIngredientCounts(entry.recipe);
      const ingredientNames = Array.from(ingredientCounts.keys())
        .map(id => mcData.items[id]?.name)
        .filter(Boolean);
      
      // Use suffix as key (log, wood, planks, etc.)
      const suffixKey = ingredientNames.map(name => getSuffixTokenFromName(name) || name).sort().join(',');
      if (!recipeBySuffix.has(suffixKey)) {
        recipeBySuffix.set(suffixKey, []);
      }
      recipeBySuffix.get(suffixKey)!.push(entry);
    }
    
    // If there are multiple ingredient alternatives (log vs wood), create separate craft nodes
    // These will be OR branches at the root level
    if (recipeBySuffix.size > 1 && context.combineSimilarNodes) {
      for (const [_suffix, subGroup] of recipeBySuffix.entries()) {
        // Clone inventory for each OR branch so they don't interfere with each other
        const branchInventory = invMap ? new Map(invMap) : invMap;
        const branchContext = { ...context, inventory: branchInventory };
        createCraftNodeForGroup(subGroup, craftingsNeeded, variantMode, root, branchContext, mcData, nextVisited, ctx);
      }
      continue; // Skip the default single craft node creation below
    }

    // Create variant groups for craft node
    const whatVariants: VariantGroup<'table' | 'inventory'> = createVariantGroup(
      'one_of',
      [requiresCraftingTable(recipe) ? 'table' : 'inventory']
    );

    const resultVariants: VariantGroup<ItemReference> = {
      mode: context.combineSimilarNodes ? variantMode : 'one_of',
      variants: context.combineSimilarNodes 
        ? recipeGroup.map(entry => ({
            value: {
              item: entry.itemName,
              perCraftCount: recipe.result.count
            },
            metadata: {
              family: getFamilyFromName(entry.itemName),
              suffix: getSuffixFromName(entry.itemName)
            }
          }))
        : [{
            value: {
              item: recipeGroup[0].itemName,
              perCraftCount: recipe.result.count
            },
            metadata: {
              family: getFamilyFromName(recipeGroup[0].itemName),
              suffix: getSuffixFromName(recipeGroup[0].itemName)
            }
          }]
    };

    const ingredientVariants: VariantGroup<ItemReference[]> = {
      mode: context.combineSimilarNodes ? variantMode : 'one_of',
      variants: context.combineSimilarNodes 
        ? recipeGroup.map(entry => {
            const counts = getIngredientCounts(entry.recipe);
            return {
              value: Array.from(counts.entries())
                .sort(([a], [b]) => a - b)
                .map(([id, count]) => {
                  const ingName = mcData.items[id]?.name;
                  return {
                    item: ingName,
                    perCraftCount: count
                  };
                }),
              metadata: {
                family: getFamilyFromName(entry.itemName),
                suffix: getSuffixFromName(entry.itemName)
              }
            };
          })
        : [{
            value: Array.from(getIngredientCounts(recipeGroup[0].recipe).entries())
              .sort(([a], [b]) => a - b)
              .map(([id, count]) => {
                const ingName = mcData.items[id]?.name;
                return {
                  item: ingName,
                  perCraftCount: count
                };
              }),
            metadata: {
              family: getFamilyFromName(recipeGroup[0].itemName),
              suffix: getSuffixFromName(recipeGroup[0].itemName)
            }
          }]
    };

    // Create craft node with variant-first approach
    const craftNode: CraftNode = {
      action: 'craft',
      operator: 'AND',
      variantMode,
      what: whatVariants,
      count: craftingsNeeded,
      result: resultVariants,
      ingredients: ingredientVariants,
      variants: { mode: variantMode, variants: [] },
      children: { mode: variantMode, variants: [] },
      context
    };

    // Add constraint for downstream nodes
    if (variantMode === 'one_of') {
      constraintManager.addConstraint(primaryItem, {
        type: 'one_of',
        availableVariants: variantsToUse,
        constraintPath: context.parentPath
      });
    }

    // Add crafting table dependency if needed
    if (requiresCraftingTable(recipe) && !hasWorkstationDependency(craftNode, 'crafting_table')) {
      const craftingTableTree = createWorkstationDependencyTree('crafting_table', context, ctx);
      craftNode.children.variants.push({ value: craftingTableTree });
    }

    // Process ingredients recursively
    // Group ingredients by suffix (oak_log and stripped_oak_log together, oak_wood and stripped_oak_wood together)
    // These become OR alternatives (you can use logs OR wood, not both)
    const ingredientVariantsList = ingredientVariants.variants || [];
    const ingredientGroupsBySuffix = new Map<string, { items: string[]; primary: string; count: number }>();

    // Collect all unique ingredient items across all recipe variants
    const allIngredientItems = new Set<string>();
    for (const variant of ingredientVariantsList) {
      const ingredients = variant.value || [];
      for (const ingredient of ingredients) {
        if (ingredient?.item) {
          allIngredientItems.add(ingredient.item);
        }
      }
    }

    // Group ingredients by suffix family (log vs wood vs planks, etc.)
    for (const ingredientItem of allIngredientItems) {
      // Find the actual count from one of the recipe variants
      let actualCount = 1;
      for (const variant of ingredientVariantsList) {
        const ingredients = variant.value || [];
        const matchingIngredient = ingredients.find(ing => ing?.item === ingredientItem);
        if (matchingIngredient) {
          actualCount = matchingIngredient.perCraftCount || 1;
          break;
        }
      }
      
      const requiredCount = actualCount * craftingsNeeded;
      // Use cross-family matching for ingredients: any log type can be used to craft planks
      const similarItems = context.combineSimilarNodes
        ? Array.from(new Set(findSimilarItems(mcData, ingredientItem)))
        : [ingredientItem];
      if (similarItems.length === 0) continue;
      
      // Group by suffix to create OR alternatives
      const suffix = getSuffixTokenFromName(ingredientItem) || ingredientItem;
      if (!ingredientGroupsBySuffix.has(suffix)) {
        ingredientGroupsBySuffix.set(suffix, {
          items: similarItems,
          primary: ingredientItem,
          count: requiredCount
        });
      } else {
        // Merge items with the same suffix
        const existing = ingredientGroupsBySuffix.get(suffix)!;
        existing.items = Array.from(new Set([...existing.items, ...similarItems]));
      }
    }

    const groupedIngredients = Array.from(ingredientGroupsBySuffix.values()).sort((a, b) => a.primary.localeCompare(b.primary));

    for (const group of groupedIngredients) {
      const ingredientItems = group.items;
      const ingredientPrimary = group.primary || ingredientItems[0];
      const ingredientContext: BuildContext = {
        ...context,
        visited: nextVisited,
        depth: context.depth + 1,
        parentPath: [...context.parentPath, ingredientPrimary],
        variantConstraints: constraintManager.clone()
      };

      const ingredientTree = buildRecipeTreeInternal(ctx, ingredientItems, group.count, ingredientContext);
      craftNode.children.variants.push({ value: ingredientTree });
    }

    // Add craft node to root
    root.children.variants.push({ value: craftNode });
  }

  // Process smelting recipes
  // Clone inventory for this OR branch
  const smeltInventory = invMap ? new Map(invMap) : invMap;
  const smeltContext = { ...context, inventory: smeltInventory };
  const smeltInputs = findFurnaceSmeltsForItem(mcData, primaryItem);
  if (smeltInputs.length > 0) {
    
    const smeltGroup: SmeltGroupNode = {
      action: 'smelt',
      operator: 'OR',
      variantMode: 'any_of', // Any fuel works
      what: createVariantGroup('any_of', [primaryItem]),
      count: targetCount,
      variants: { mode: 'any_of', variants: [] },
      children: { mode: 'any_of', variants: [] },
      context: smeltContext
    };

    // Add smelt nodes for each input
    for (const smeltInput of smeltInputs) {
      const smeltNode: SmeltNode = {
        action: 'smelt',
        operator: 'AND',
        variantMode: 'any_of',
        what: createVariantGroup('any_of', ['furnace']),
        count: targetCount,
        input: createVariantGroup('any_of', [{
          item: smeltInput,
          perSmelt: 1
        }]),
        result: createVariantGroup('any_of', [{
          item: primaryItem,
          perSmelt: 1
        }]),
        fuel: createVariantGroup('any_of', ['coal']), // Default fuel
        variants: { mode: 'any_of', variants: [] },
        children: { mode: 'any_of', variants: [] },
        context: smeltContext
      };

      // Add furnace dependency if not already present
      if (!hasWorkstationDependency(smeltNode, 'furnace')) {
        const furnaceTree = createWorkstationDependencyTree('furnace', smeltContext, ctx);
        smeltNode.children.variants.push({ value: furnaceTree });
      }

      smeltGroup.children.variants.push({ value: smeltNode });
    }

    // Add smelt group to root
    root.children.variants.push({ value: smeltGroup });
  }

  // Process mining paths
  // Clone inventory for this OR branch
  const mineInventory = invMap ? new Map(invMap) : invMap;
  const mineContext = { ...context, inventory: mineInventory };
  
  const allMiningPaths: BlockSource[] = [];
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
  const miningPaths = allMiningPaths;
  const canonicalBlockByItem = new Map<string, string>();
  const blockVariantsByCanonical = new Map<string, string[]>();
  miningPaths.forEach(path => {
    const blockName = path.block;
    // For blocks, use two strategies:
    // 1. findBlocksWithSameDrop for ore-like blocks (groups blocks that drop the same item with same tool requirements)
    // 2. findSimilarItems for wood-like blocks (groups blocks with same suffix like logs)
    const sameDrop = context.combineSimilarNodes ? findBlocksWithSameDrop(mcData, blockName) : [blockName];
    const sameFamily = context.combineSimilarNodes ? findSimilarItems(mcData, blockName) : [blockName];
    // Use whichever returns more results (prioritize drop-based grouping if it finds matches)
    const similar = sameDrop.length > sameFamily.length ? sameDrop : sameFamily;
    
    // Store all block variants for this canonical block
    if (!blockVariantsByCanonical.has(blockName)) {
      blockVariantsByCanonical.set(blockName, similar);
    }
    
    similar.forEach(itemName => {
      if (!canonicalBlockByItem.has(itemName)) {
        canonicalBlockByItem.set(itemName, blockName);
      }
    });
  });
  if (miningPaths.length > 0) {
    const mineTargets = context.combineSimilarNodes ? variantsToUse : [primaryItem];
    const usingMineTargets = mineTargets;

    const mineGroup: MineGroupNode = {
      action: 'mine',
      operator: 'OR',
      variantMode: 'any_of',
      what: createVariantGroup('any_of', usingMineTargets),
      targetItem: createVariantGroup('any_of', usingMineTargets),
      count: targetCount,
      variants: { mode: 'any_of', variants: [] },
      children: { mode: 'any_of', variants: [] },
      context: mineContext
    };

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

    const mineLeafByCanon = new Map<string, MineLeafNode>();

    for (const [toolKey, pathGroup] of groupedByTool) {
      const minimalTool = toolKey === 'any' ? undefined : toolKey;
      const blocks = pathGroup.map(p => p.block);
      const filteredBlocks = filterResourceVariants(mineContext, 'blocks', blocks);
      if (filteredBlocks.length === 0) {
        continue;
      }

      const baseLeaf: MineLeafNode = {
        action: 'mine',
        variantMode: 'any_of',
        what: createVariantGroup('any_of', filteredBlocks),
        targetItem: createVariantGroup('any_of', usingMineTargets),
        count: targetCount,
        ...(minimalTool ? { tool: createVariantGroup('any_of', [minimalTool]) } : {}),
        variants: { mode: 'any_of', variants: [] },
        children: { mode: 'any_of', variants: [] },
        context: mineContext
      };

      if (minimalTool && !hasToolDependency(baseLeaf, minimalTool)) {
        const toolTree = createToolDependencyTree(minimalTool, mineContext, ctx);
        baseLeaf.children.variants.push({ value: toolTree });
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
              const filteredVariants = filterResourceVariants(mineContext, 'blocks', blockVariants);
              if (filteredVariants.length === 0) {
                continue;
              }

              const leaf: MineLeafNode = {
                ...baseLeaf,
                what: createVariantGroup('any_of', filteredVariants),
                targetItem: createVariantGroup('any_of', usingMineTargets)
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

    mineLeafByCanon.forEach(leaf => {
      mineGroup.children.variants.push({ value: leaf });
    });

    if (mineGroup.children.variants.length > 0) {
      root.children.variants.push({ value: mineGroup });
    }
  }

  // Process hunting paths
  // Clone inventory for this OR branch
  const huntInventory = invMap ? new Map(invMap) : invMap;
  const huntContext = { ...context, inventory: huntInventory };
  const huntingPaths = findMobsThatDrop(mcData, primaryItem);
  if (huntingPaths.length > 0) {
    const huntVariants = huntingPaths.map(path => path.mob);
    const filteredHuntVariants = filterResourceVariants(huntContext, 'entities', huntVariants);
    const skipHuntBranch = filteredHuntVariants.length === 0 && isWorldPruningEnabled(huntContext);
    const huntSourceNames = filteredHuntVariants.length > 0 ? filteredHuntVariants : huntVariants;

    if (!skipHuntBranch) {
      const huntGroup: HuntGroupNode = {
      action: 'hunt',
      operator: 'OR',
      variantMode: 'any_of', // Any mob variant works
        what: createVariantGroup('any_of', huntSourceNames),
      count: targetCount,
      variants: { mode: 'any_of', variants: [] },
      children: { mode: 'any_of', variants: [] },
      context: huntContext
      };

      // Add hunt leaf nodes for each mob that drops the item
      for (const huntingPath of huntingPaths) {
        if (!huntSourceNames.includes(huntingPath.mob)) {
          continue;
        }
        const huntLeaf: HuntLeafNode = {
          action: 'hunt',
          variantMode: 'any_of',
          what: createVariantGroup('any_of', [huntingPath.mob]),
          targetItem: createVariantGroup('any_of', [primaryItem]),
          count: targetCount,
          dropChance: huntingPath.dropChance ? createVariantGroup('any_of', [huntingPath.dropChance]) : undefined,
          // Hunting doesn't typically require tools, but we can add if needed
          variants: { mode: 'any_of', variants: [] },
          children: { mode: 'any_of', variants: [] },
          context: huntContext
        };

        huntGroup.children.variants.push({ value: huntLeaf });
      }

      if (huntGroup.children.variants.length > 0) {
        root.children.variants.push({ value: huntGroup });
      }
    }
  }

  return root;
}

// Variant-first system is now complete
// The tree building process now uses VariantConstraintManager to ensure consistency