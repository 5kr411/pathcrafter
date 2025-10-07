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
import { findSimilarItems } from '../utils/itemSimilarity';
import { getIngredientCounts, findFurnaceSmeltsForItem, requiresCraftingTable, getRecipeCanonicalKey } from '../utils/recipeUtils';
import { findBlocksThatDrop, findMobsThatDrop } from '../utils/sourceLookup';

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
  
  // Find all similar items (wood families, etc.) only if combining is enabled
  const itemGroup = context.combineSimilarNodes ? findSimilarItems(mcData, itemName) : [itemName];
  
  // Create variant-first context
  const variantContext: BuildContext = {
    inventory: context.inventory || new Map(),
    worldBudget: context.worldBudget,
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

  // Group recipes by canonical shape (same structure across different wood types)
  const recipeGroups = new Map<string, Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}>>();
  for (const entry of allRecipes) {
    // Group similar recipes together only if combining is enabled
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
    const firstIngredients = ingredientVariants.variants[0].value;
    for (const ingredient of firstIngredients) {
      const ingredientName = ingredient.item;
      const ingredientCount = (ingredient.perCraftCount || 1) * craftingsNeeded;
      
      // Create new context for ingredient
      const ingredientContext: BuildContext = {
        ...context,
        visited: nextVisited,
        depth: context.depth + 1,
        parentPath: [...context.parentPath, ingredientName],
        variantConstraints: constraintManager.clone()
      };

      // Build tree for ingredient
      const ingredientTree = buildRecipeTreeInternal(ctx, [ingredientName], ingredientCount, ingredientContext);
      
      // Add ingredient tree as child of craft node
      craftNode.children.variants.push({ value: ingredientTree });
    }

    // Add craft node to root
    root.children.variants.push({ value: craftNode });
  }

  // Process smelting recipes
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
      context
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
        context
      };

      // Add furnace dependency if not already present
      if (!hasWorkstationDependency(smeltNode, 'furnace')) {
        const furnaceTree = createWorkstationDependencyTree('furnace', context, ctx);
        smeltNode.children.variants.push({ value: furnaceTree });
      }

      smeltGroup.children.variants.push({ value: smeltNode });
    }

    // Add smelt group to root
    root.children.variants.push({ value: smeltGroup });
  }

  // Process mining paths
  const miningPaths = findBlocksThatDrop(mcData, primaryItem);
  if (miningPaths.length > 0) {
    const mineGroup: MineGroupNode = {
      action: 'mine',
      operator: 'OR',
      variantMode: 'any_of', // Any block variant works
      what: createVariantGroup('any_of', [primaryItem]),
      targetItem: createVariantGroup('any_of', [primaryItem]),
      count: targetCount,
      variants: { mode: 'any_of', variants: [] },
      children: { mode: 'any_of', variants: [] },
      context
    };

    // Group mining paths by tool requirement (always combine paths with same tool)
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

    // Create mine leaf nodes for each tool group
    for (const [toolKey, pathGroup] of groupedByTool) {
      const minimalTool = toolKey === 'any' ? 'any' : toolKey;
      let blocks = pathGroup.map(p => p.block);
      
      // If combining is enabled, expand blocks to include similar variants
      if (context.combineSimilarNodes) {
        const allSimilarBlocks = new Set<string>();
        for (const block of blocks) {
          const similarBlocks = findSimilarItems(mcData, block);
          similarBlocks.forEach(b => allSimilarBlocks.add(b));
        }
        blocks = Array.from(allSimilarBlocks);
      }
      
      const mineLeaf: MineLeafNode = {
        action: 'mine',
        variantMode: 'any_of',
        what: createVariantGroup('any_of', blocks),
        targetItem: createVariantGroup('any_of', variantsToUse),
        count: targetCount,
        tool: createVariantGroup('any_of', [minimalTool]),
        variants: { mode: 'any_of', variants: [] },
        children: { mode: 'any_of', variants: [] },
        context
      };

      // Add tool dependency if needed and not already present
      if (minimalTool && minimalTool !== 'any' && !hasToolDependency(mineLeaf, minimalTool)) {
        const toolTree = createToolDependencyTree(minimalTool, context, ctx);
        mineLeaf.children.variants.push({ value: toolTree });
      }

      mineGroup.children.variants.push({ value: mineLeaf });
    }

    // Add mine group to root
    root.children.variants.push({ value: mineGroup });
  }

  // Process hunting paths
  const huntingPaths = findMobsThatDrop(mcData, primaryItem);
  if (huntingPaths.length > 0) {
    const huntGroup: HuntGroupNode = {
      action: 'hunt',
      operator: 'OR',
      variantMode: 'any_of', // Any mob variant works
      what: createVariantGroup('any_of', [primaryItem]),
      count: targetCount,
      variants: { mode: 'any_of', variants: [] },
      children: { mode: 'any_of', variants: [] },
      context
    };

    // Add hunt leaf nodes for each mob that drops the item
    for (const huntingPath of huntingPaths) {
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
        context
      };

      huntGroup.children.variants.push({ value: huntLeaf });
    }

    // Add hunt group to root
    root.children.variants.push({ value: huntGroup });
  }

  return root;
}

// Variant-first system is now complete
// The tree building process now uses VariantConstraintManager to ensure consistency