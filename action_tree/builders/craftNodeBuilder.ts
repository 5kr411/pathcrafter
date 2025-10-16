/**
 * Craft node builder
 * 
 * Handles creation of craft nodes and their ingredient dependencies.
 * Supports variant-first approach with recipe grouping and deduplication.
 */

import {
  BuildContext,
  CraftNode,
  RootNode,
  VariantGroup,
  ItemReference
} from '../types';
import {
  getFamilyFromName,
  getSuffixFromName,
  createVariantGroup,
  cloneInventoryForBranch,
  createIngredientContext
} from './nodeBuilderHelpers';
import {
  addVariantConstraint
} from './variantResolver';
import {
  groupRecipesByCanonicalKey,
  groupRecipesBySuffix,
  collectRecipesForVariants,
  RecipeEntry
} from './recipeGrouper';
import {
  BuildRecipeTreeFn,
  injectWorkstationDependency
} from './dependencyInjector';
import { requiresCraftingTable, getIngredientCounts, hasCircularDependency } from '../utils/recipeUtils';
import { findIngredientAlternatives } from '../utils/itemSimilarity';
import { getSuffixTokenFromName } from '../../utils/items';

/**
 * Builds craft nodes for an item and adds them to the root node
 */
export function buildCraftNodes(
  variantsToUse: string[],
  variantMode: 'one_of' | 'any_of',
  primaryItem: string,
  targetCount: number,
  root: RootNode,
  context: BuildContext,
  ctx: any,
  mcData: any,
  nextVisited: Set<string>,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const allRecipes = collectRecipesForVariants(variantsToUse, mcData);
  const recipeGroups = groupRecipesByCanonicalKey(allRecipes, context.combineSimilarNodes || false);

  for (const [_canonicalKey, recipeGroup] of recipeGroups.entries()) {
    const recipe = recipeGroup[0].recipe;
    const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
    
    let hasVaryingIngredients = false;
    if (context.combineSimilarNodes && recipeGroup.length > 1) {
      const ingredientsByRecipe = recipeGroup.map(entry => {
        const counts = getIngredientCounts(entry.recipe);
        return new Set(Array.from(counts.keys()).map(id => mcData.items[id]?.name).filter(Boolean));
      });
      
      const allIngsFirstRecipe = ingredientsByRecipe[0];
      for (let i = 1; i < ingredientsByRecipe.length; i++) {
        const currentIngs = ingredientsByRecipe[i];
        const allIngs = new Set([...allIngsFirstRecipe, ...currentIngs]);
        
        for (const ing of allIngs) {
          if (!allIngsFirstRecipe.has(ing) || !currentIngs.has(ing)) {
            hasVaryingIngredients = true;
            break;
          }
        }
        if (hasVaryingIngredients) break;
      }
    }
    
    if (hasVaryingIngredients) {
      createSingleCraftNode(
        recipeGroup,
        variantMode,
        primaryItem,
        variantsToUse,
        craftingsNeeded,
        root,
        context,
        ctx,
        mcData,
        nextVisited,
        buildRecipeTreeFn
      );
    } else {
      const recipeBySuffix = groupRecipesBySuffix(recipeGroup, mcData);
      
      if (recipeBySuffix.size > 1 && context.combineSimilarNodes) {
        for (const [_suffix, subGroup] of recipeBySuffix.entries()) {
          const branchContext = cloneInventoryForBranch(context);
          createSingleCraftNode(
            subGroup,
            variantMode,
            primaryItem,
            variantsToUse,
            craftingsNeeded,
            root,
            branchContext,
            ctx,
            mcData,
            nextVisited,
            buildRecipeTreeFn
          );
        }
      } else {
        createSingleCraftNode(
          recipeGroup,
          variantMode,
          primaryItem,
          variantsToUse,
          craftingsNeeded,
          root,
          context,
          ctx,
          mcData,
          nextVisited,
          buildRecipeTreeFn
        );
      }
    }
  }
}

/**
 * Creates a single craft node with all its dependencies
 */
function createSingleCraftNode(
  recipeGroup: RecipeEntry[],
  variantMode: 'one_of' | 'any_of',
  primaryItem: string,
  variantsToUse: string[],
  craftingsNeeded: number,
  parentNode: RootNode,
  context: BuildContext,
  ctx: any,
  mcData: any,
  visited: Set<string>,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const recipe = recipeGroup[0].recipe;
  
  // Inventory-gated anti-cycle guard:
  // If any ingredient forms a direct conversion cycle with the result (e.g.,
  // ingot ↔ nugget or ingot ↔ block), only allow this craft path when the
  // cyclic ingredient is already present in inventory in sufficient quantity
  // for the required number of craftings. This prevents the tree from
  // introducing circular dependencies as acquisition strategies.
  if (recipe && recipe.result && typeof recipe.result.id === 'number') {
    const resultId = recipe.result.id;
    const ingredientCounts = getIngredientCounts(recipe);
    for (const [ingredientId, perCraftCount] of ingredientCounts.entries()) {
      if (typeof ingredientId !== 'number') continue;
      if (hasCircularDependency(mcData, resultId, ingredientId)) {
        const ingredientName = mcData.items[ingredientId]?.name;
        const haveInInventory = ingredientName ? (context.inventory?.get(ingredientName) || 0) : 0;
        const requiredForThisNode = (perCraftCount || 1) * (craftingsNeeded || 1);
        if (haveInInventory < requiredForThisNode) {
          return; // Drop this craft node to avoid circular acquisition
        }
      }
    }
  }
  const constraintManager = context.variantConstraints;
  
  const whatVariants: VariantGroup<'table' | 'inventory'> = createVariantGroup(
    'one_of',
    [requiresCraftingTable(recipe) ? 'table' : 'inventory']
  );

  const resultVariants = createResultVariants(recipeGroup, recipe, context, variantMode);
  const ingredientVariants = createIngredientVariants(recipeGroup, recipe, context, mcData, variantMode);

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

  addVariantConstraint(constraintManager, primaryItem, variantsToUse, variantMode, context);

  if (requiresCraftingTable(recipe)) {
    injectWorkstationDependency(craftNode, 'crafting_table', context, ctx, buildRecipeTreeFn);
  }

  processIngredientDependencies(
    craftNode,
    ingredientVariants,
    craftingsNeeded,
    recipeGroup,
    primaryItem,
    context,
    ctx,
    mcData,
    visited,
    buildRecipeTreeFn
  );

  parentNode.children.variants.push({ value: craftNode });
}

/**
 * Creates result variants for a craft node
 */
function createResultVariants(
  recipeGroup: RecipeEntry[],
  recipe: any,
  context: BuildContext,
  variantMode: 'one_of' | 'any_of'
): VariantGroup<ItemReference> {
  return {
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
}

/**
 * Creates ingredient variants for a craft node
 */
function createIngredientVariants(
  recipeGroup: RecipeEntry[],
  _recipe: any,
  context: BuildContext,
  mcData: any,
  variantMode: 'one_of' | 'any_of'
): VariantGroup<ItemReference[]> {
  return {
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
}

/**
 * Processes ingredient dependencies and adds them to the craft node
 */
function processIngredientDependencies(
  craftNode: CraftNode,
  ingredientVariants: VariantGroup<ItemReference[]>,
  craftingsNeeded: number,
  recipeGroup: RecipeEntry[],
  _resultItemName: string,
  context: BuildContext,
  ctx: any,
  mcData: any,
  visited: Set<string>,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const ingredientVariantsList = ingredientVariants.variants || [];
  const ingredientGroupsBySuffix = new Map<string, { items: string[]; primary: string; count: number }>();

  const allIngredientItems = new Set<string>();
  for (const variant of ingredientVariantsList) {
    const ingredients = variant.value || [];
    for (const ingredient of ingredients) {
      if (ingredient?.item) {
        allIngredientItems.add(ingredient.item);
      }
    }
  }

  const recipeBasedAlternativesCache = new Map<string, string[]>();
  if (context.combineSimilarNodes && recipeGroup.length > 1) {
    const ingredientsByRecipe = recipeGroup.map(entry => {
      const counts = getIngredientCounts(entry.recipe);
      return new Set(Array.from(counts.keys()).map(id => mcData.items[id]?.name).filter(Boolean));
    });
    
    const varyingIngredients = new Set<string>();
    const constantIngredients = new Set<string>(ingredientsByRecipe[0]);
    
    for (let i = 1; i < ingredientsByRecipe.length; i++) {
      const currentSet = ingredientsByRecipe[i];
      const allIngs = new Set([...constantIngredients, ...currentSet]);
      
      for (const ing of allIngs) {
        if (!constantIngredients.has(ing) || !currentSet.has(ing)) {
          varyingIngredients.add(ing);
          constantIngredients.delete(ing);
        }
      }
    }
    
    for (const varyingIng of varyingIngredients) {
      recipeBasedAlternativesCache.set(varyingIng, Array.from(varyingIngredients));
    }
  }

  for (const ingredientItem of allIngredientItems) {
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
    let similarItems: string[];
    let groupKey: string;
    
    if (context.combineSimilarNodes) {
      const cachedAlternatives = recipeBasedAlternativesCache.get(ingredientItem);
      if (cachedAlternatives && cachedAlternatives.length > 1) {
        similarItems = cachedAlternatives;
        // Use the sorted list of alternatives as the group key to ensure all variants group together
        groupKey = [...cachedAlternatives].sort().join('|');
      } else {
        similarItems = Array.from(new Set(findIngredientAlternatives(mcData, ingredientItem)));
        groupKey = getSuffixTokenFromName(ingredientItem) || ingredientItem;
      }
    } else {
      similarItems = [ingredientItem];
      groupKey = getSuffixTokenFromName(ingredientItem) || ingredientItem;
    }
    if (similarItems.length === 0) continue;
    
    if (!ingredientGroupsBySuffix.has(groupKey)) {
      ingredientGroupsBySuffix.set(groupKey, {
        items: similarItems,
        primary: ingredientItem,
        count: requiredCount
      });
    } else {
      const existing = ingredientGroupsBySuffix.get(groupKey)!;
      existing.items = Array.from(new Set([...existing.items, ...similarItems]));
    }
  }

  const groupedIngredients = Array.from(ingredientGroupsBySuffix.values())
    .sort((a, b) => a.primary.localeCompare(b.primary));

  for (const group of groupedIngredients) {
    const ingredientItems = group.items;
    const ingredientPrimary = group.primary || ingredientItems[0];
    const ingredientContext = createIngredientContext(ingredientPrimary, context, visited);

    const ingredientTree = buildRecipeTreeFn(ctx, ingredientItems, group.count, ingredientContext);
    craftNode.children.variants.push({ value: ingredientTree });
  }
}
