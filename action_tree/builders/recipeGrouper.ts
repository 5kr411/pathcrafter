/**
 * Recipe grouping utilities
 * 
 * Provides functions for grouping recipes by canonical structure,
 * ingredient patterns, and other criteria for variant-first processing.
 */

import { MinecraftRecipe } from '../types';
import { getRecipeCanonicalKey, getIngredientCounts, normalizeWoodSuffix } from '../utils/recipeUtils';
import { getSuffixTokenFromName } from '../../utils/items';

/**
 * Grouped recipe entry with item info
 */
export interface RecipeEntry {
  recipe: MinecraftRecipe;
  itemName: string;
  itemId: number;
}

/**
 * Groups recipes by their canonical key (same structure)
 * 
 * Recipes with the same canonical key have the same shape and can
 * be combined into variant groups. For example, oak_planks and
 * spruce_planks crafting recipes have the same structure.
 */
export function groupRecipesByCanonicalKey(
  recipes: RecipeEntry[],
  combineSimilarNodes: boolean
): Map<string, RecipeEntry[]> {
  const recipeGroups = new Map<string, RecipeEntry[]>();
  
  for (const entry of recipes) {
    const key = combineSimilarNodes 
      ? getRecipeCanonicalKey(entry.recipe) 
      : entry.itemName;
    
    if (!recipeGroups.has(key)) {
      recipeGroups.set(key, []);
    }
    recipeGroups.get(key)!.push(entry);
  }
  
  return recipeGroups;
}

/**
 * Groups recipes by ingredient suffix pattern
 * 
 * This is used to identify recipe alternatives like oak_log vs oak_wood
 * for crafting oak_planks. These become OR branches in the tree.
 */
export function groupRecipesBySuffix(
  recipes: RecipeEntry[],
  mcData: any
): Map<string, RecipeEntry[]> {
  const recipeBySuffix = new Map<string, RecipeEntry[]>();
  
  for (const entry of recipes) {
    const suffixKey = getIngredientSuffixKey(entry.recipe, mcData);
    
    if (!recipeBySuffix.has(suffixKey)) {
      recipeBySuffix.set(suffixKey, []);
    }
    recipeBySuffix.get(suffixKey)!.push(entry);
  }
  
  return recipeBySuffix;
}

/**
 * Extracts suffix pattern from recipe ingredients
 * 
 * Creates a key based on ingredient suffixes (e.g., "log" or "wood")
 * to identify alternative recipes. Uses normalized suffixes for wood-related
 * items to enable aggressive grouping across log/wood/stem/hyphae.
 */
export function getIngredientSuffixKey(recipe: MinecraftRecipe, mcData: any): string {
  const ingredientCounts = getIngredientCounts(recipe);
  const ingredientNames = Array.from(ingredientCounts.keys())
    .map(id => mcData.items[id]?.name)
    .filter(Boolean);
  
  const suffixKey = ingredientNames
    .map(name => {
      const suffix = getSuffixTokenFromName(name) || name;
      return normalizeWoodSuffix(suffix);
    })
    .sort()
    .join(',');
  
  return suffixKey;
}

/**
 * Collects all recipes for a list of item variants
 */
export function collectRecipesForVariants(
  variantsToUse: string[],
  mcData: any
): RecipeEntry[] {
  const allRecipes: RecipeEntry[] = [];
  
  for (const name of variantsToUse) {
    const itemData = mcData.itemsByName[name];
    if (itemData) {
      const rawRecipes = mcData.recipes[itemData.id] || [];
      for (const recipe of rawRecipes) {
        allRecipes.push({ recipe, itemName: name, itemId: itemData.id });
      }
    }
  }
  
  return allRecipes;
}

