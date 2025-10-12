/**
 * Recipe processing utilities
 * 
 * Provides functions for analyzing, canonicalizing, and deduplicating
 * Minecraft recipes.
 */

import { MinecraftData, MinecraftRecipe } from '../types';
import { getSuffixTokenFromName } from '../../utils/items';
import { getFurnaceInputsFor } from '../../utils/smeltingConfig';

/**
 * Wood-related suffixes that should be normalized for aggressive grouping
 */
const WOOD_SUFFIXES = new Set(['log', 'wood', 'stem', 'hyphae']);

/**
 * Normalizes wood-related suffixes for aggressive grouping
 * 
 * This allows recipes using different wood sources (log, wood, stem, hyphae)
 * to be grouped together when they produce the same output count.
 * 
 * @param suffix - Item suffix to normalize
 * @returns Normalized suffix or original if not wood-related
 * 
 * @example
 * ```typescript
 * normalizeWoodSuffix('log') // returns 'wood_source'
 * normalizeWoodSuffix('stem') // returns 'wood_source'
 * normalizeWoodSuffix('hyphae') // returns 'wood_source'
 * normalizeWoodSuffix('planks') // returns 'planks' (unchanged)
 * ```
 */
export function normalizeWoodSuffix(suffix: string): string {
  if (WOOD_SUFFIXES.has(suffix)) {
    return 'wood_source';
  }
  return suffix;
}

/**
 * Gets the item name from an item ID
 * 
 * @param mcData - Minecraft data object
 * @param id - Item ID
 * @returns Item name or string representation of ID if not found
 */
export function getItemName(mcData: MinecraftData, id: number): string {
  return mcData.items[id]?.name || String(id);
}

/**
 * Checks if a recipe requires a crafting table
 * 
 * @param recipe - Minecraft recipe to check
 * @returns True if recipe requires a crafting table (larger than 2x2)
 * 
 * @example
 * ```typescript
 * const recipe = { inShape: [[1, 2, 3], [4, 5, 6]] };
 * const needsTable = requiresCraftingTable(recipe); // true
 * ```
 */
export function requiresCraftingTable(recipe: MinecraftRecipe): boolean {
  if (recipe.ingredients) return false;
  if (recipe.inShape) {
    const tooWide = recipe.inShape.some(row => row.length > 2);
    const tooTall = recipe.inShape.length > 2;
    return tooWide || tooTall;
  }
  return false;
}

/**
 * Gets a canonical key for a recipe based on its shape/structure (ignoring specific wood types)
 * 
 * This creates a key that groups recipes with the same structure but different
 * wood types (e.g., oak_planks vs spruce_planks recipes).
 * 
 * @param recipe - Minecraft recipe to analyze
 * @returns Canonical key string
 * 
 * @example
 * ```typescript
 * const recipe = { inShape: [[1, 1], [1, 1]], result: { count: 4 } };
 * const key = getRecipeCanonicalKey(recipe);
 * // Returns: "shaped:false:4:[[1,1],[1,1]]"
 * ```
 */
export function getRecipeCanonicalKey(recipe: MinecraftRecipe): string {
  // Combine info about the recipe type and requirements
  const tableRequired = requiresCraftingTable(recipe);
  const resultCount = recipe.result?.count || 1;
  
  if (recipe.inShape) {
    // For shaped recipes, use the shape pattern
    const shapeKey = JSON.stringify(recipe.inShape?.map(row => row.map(cell => cell === null ? 0 : 1)));
    return `shaped:${tableRequired}:${resultCount}:${shapeKey}`;
  } else if (recipe.ingredients) {
    // For shapeless recipes, use sorted ingredient count
    const ingredientCount = recipe.ingredients.length;
    return `shapeless:${tableRequired}:${resultCount}:${ingredientCount}`;
  }
  
  return `other:${tableRequired}:${resultCount}`;
}

/**
 * Canonicalizes a shaped recipe for deduplication
 * 
 * Converts shaped recipes to a canonical form by replacing specific item IDs
 * with their suffix tokens (e.g., oak_log -> log, spruce_log -> log).
 * 
 * @param mcData - Minecraft data object
 * @param recipe - Shaped recipe to canonicalize
 * @returns Canonical JSON string representation
 * 
 * @example
 * ```typescript
 * const recipe = { inShape: [[1, 2], [3, 4]] }; // oak_log, spruce_log, etc.
 * const canonical = canonicalizeShapedRecipe(mcData, recipe);
 * // Returns: "[[\"log\",\"log\"],[\"log\",\"log\"]]"
 * ```
 */
export function canonicalizeShapedRecipe(mcData: MinecraftData, recipe: MinecraftRecipe): string {
  const rows = recipe.inShape || [];
  const canonRows = rows.map(row =>
    row.map(cell => {
      if (cell === null || cell === undefined) return 0;
      const name = getItemName(mcData, cell);
      return getSuffixTokenFromName(name);
    })
  );
  return JSON.stringify(canonRows);
}

/**
 * Canonicalizes a shapeless recipe for deduplication
 * 
 * Converts shapeless recipes to a canonical form by replacing specific item IDs
 * with their suffix tokens and sorting them.
 * 
 * @param mcData - Minecraft data object
 * @param recipe - Shapeless recipe to canonicalize
 * @returns Canonical JSON string representation
 * 
 * @example
 * ```typescript
 * const recipe = { ingredients: [1, 2, 3] }; // oak_log, spruce_log, birch_log
 * const canonical = canonicalizeShapelessRecipe(mcData, recipe);
 * // Returns: "[\"log\",\"log\",\"log\"]"
 * ```
 */
export function canonicalizeShapelessRecipe(mcData: MinecraftData, recipe: MinecraftRecipe): string {
  const ids = (recipe.ingredients || []).filter((id): id is number => id !== null && id !== undefined);
  const canon = ids.map(id => getSuffixTokenFromName(getItemName(mcData, id))).sort();
  return JSON.stringify(canon);
}

/**
 * Deduplicates recipes for an item
 * 
 * Removes duplicate recipes that have the same canonical structure but use
 * different wood types or materials. When preferFamilies is true, only one
 * representative recipe is kept for each canonical structure.
 * 
 * @param mcData - Minecraft data object
 * @param itemId - ID of the item to dedupe recipes for
 * @param preferFamilies - Whether to prefer family-based deduplication
 * @returns Array of deduplicated recipes
 * 
 * @example
 * ```typescript
 * const recipes = dedupeRecipesForItem(mcData, oakPlanksId, true);
 * // Returns one recipe per canonical structure, regardless of wood type
 * ```
 */
export function dedupeRecipesForItem(
  mcData: MinecraftData,
  itemId: number,
  preferFamilies: boolean = true
): MinecraftRecipe[] {
  const all = (mcData.recipes[itemId] || []);
  if (!preferFamilies) return all.slice();

  const shapedMap = new Map<string, MinecraftRecipe>();
  const shapelessMap = new Map<string, MinecraftRecipe>();

  for (const r of all) {
    if (r.inShape) {
      const key = canonicalizeShapedRecipe(mcData, r);
      if (!shapedMap.has(key)) shapedMap.set(key, r);
    } else if (r.ingredients) {
      const key = canonicalizeShapelessRecipe(mcData, r);
      if (!shapelessMap.has(key)) shapelessMap.set(key, r);
    } else {
      shapelessMap.set(Math.random() + '', r);
    }
  }

  return [...shapedMap.values(), ...shapelessMap.values()];
}

/**
 * Gets ingredient counts from a recipe
 * 
 * Extracts all ingredient IDs from a recipe (whether shaped or shapeless)
 * and counts how many of each ingredient are needed.
 * 
 * @param recipe - Minecraft recipe to analyze
 * @returns Map of ingredient ID to count
 * 
 * @example
 * ```typescript
 * const recipe = { inShape: [[1, 1], [2, 2]] }; // 2 of item 1, 2 of item 2
 * const counts = getIngredientCounts(recipe);
 * // Returns: Map { 1 => 2, 2 => 2 }
 * ```
 */
export function getIngredientCounts(recipe: MinecraftRecipe): Map<number, number> {
  const ingredients = recipe.ingredients || recipe.inShape?.flat().filter((id): id is number => id !== null && id !== undefined);
  if (!ingredients) return new Map();

  const ingredientCounts = new Map<number, number>();
  [...ingredients].sort((a, b) => (a || 0) - (b || 0)).forEach(id => {
    if (id !== null && id !== undefined) {
      ingredientCounts.set(id, (ingredientCounts.get(id) || 0) + 1);
    }
  });
  return ingredientCounts;
}

/**
 * Checks if there's a circular dependency between items
 * 
 * Determines if crafting item A requires item B, and crafting item B
 * requires item A, creating a circular dependency.
 * 
 * @param mcData - Minecraft data object
 * @param itemId - ID of the first item
 * @param ingredientId - ID of the potential ingredient
 * @returns True if there's a circular dependency
 * 
 * @example
 * ```typescript
 * const isCircular = hasCircularDependency(mcData, stickId, plankId);
 * // Returns true if sticks require planks and planks require sticks
 * ```
 */
export function hasCircularDependency(mcData: MinecraftData, itemId: number, ingredientId: number): boolean {
  const ingredientRecipes = mcData.recipes[ingredientId] || [];
  return ingredientRecipes.some(r =>
    (r.ingredients && r.ingredients.includes(itemId)) ||
    (r.inShape && r.inShape.some(row => row.includes(itemId)))
  );
}

/**
 * Finds furnace smelt inputs for an item
 * 
 * Gets all items that can be smelted to produce the target item.
 * Filters out items that don't exist in the current Minecraft version.
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to find smelt inputs for
 * @returns Array of item names that can be smelted to produce the target
 * 
 * @example
 * ```typescript
 * const inputs = findFurnaceSmeltsForItem(mcData, 'iron_ingot');
 * // Returns: ['raw_iron', 'iron_nugget'] (if they exist in this version)
 * ```
 */
export function findFurnaceSmeltsForItem(mcData: MinecraftData, itemName: string): string[] {
  const inputs = getFurnaceInputsFor(itemName);
  return inputs.filter((n: string) => !!mcData.itemsByName[n]);
}
