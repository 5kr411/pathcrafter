/**
 * Item similarity utilities
 * 
 * Provides functions for finding similar items that can be used interchangeably
 * in recipes (e.g., different wood types like oak_planks, spruce_planks).
 */

import { MinecraftData } from '../types';
import { getSuffixTokenFromName } from '../../utils/items';

/**
 * Known combinable suffixes that represent item families
 * 
 * These suffixes indicate items that can be used interchangeably in recipes.
 * For example, oak_planks and spruce_planks both have the 'planks' suffix
 * and can be used in the same recipes.
 */
const COMBINABLE_SUFFIXES = new Set([
  'log', 'wood', 'planks', 'stem', 'hyphae',
  'button', 'door', 'fence', 'fence_gate', 'pressure_plate',
  'sign', 'slab', 'stairs', 'trapdoor', 'boat', 'chest_boat'
]);

/**
 * Finds all items similar to the given item (same suffix AND should be combinable)
 * 
 * Only groups items that are part of known families (wood types, nether wood types, bamboo).
 * Items are considered similar if they:
 * 1. Have the same suffix (e.g., 'planks', 'log')
 * 2. Have the same number of underscore-separated parts
 * 3. The suffix is in the combinable suffixes list
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to find similar items for
 * @returns Array of similar item names, or just the original item if no similar items found
 * 
 * @example
 * ```typescript
 * const similar = findSimilarItems(mcData, 'oak_planks');
 * // Returns: ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', ...]
 * 
 * const similar = findSimilarItems(mcData, 'iron_ingot');
 * // Returns: ['iron_ingot'] (not combinable with other ingots)
 * ```
 */
export function findSimilarItems(mcData: MinecraftData, itemName: string): string[] {
  const suffix = getSuffixTokenFromName(itemName);
  if (!suffix) return [itemName];
  
  // Only combine if this is a combinable suffix
  if (!COMBINABLE_SUFFIXES.has(suffix)) {
    return [itemName];
  }
  
  // Find all items with same suffix
  const similar: string[] = [];
  for (const name of Object.keys(mcData.itemsByName)) {
    if (getSuffixTokenFromName(name) === suffix) {
      // Additional check: both items should have the same prefix pattern
      // (oak_planks and spruce_planks both have wood type prefix + underscore + suffix)
      const itemParts = itemName.split('_');
      const nameParts = name.split('_');
      if (itemParts.length === nameParts.length) {
        similar.push(name);
      }
    }
  }
  
  return similar.length > 1 ? similar : [itemName];
}

/**
 * Checks if two items are similar (can be used interchangeably)
 * 
 * @param mcData - Minecraft data object
 * @param item1 - First item name
 * @param item2 - Second item name
 * @returns True if the items are similar
 * 
 * @example
 * ```typescript
 * const areSimilar = areItemsSimilar(mcData, 'oak_planks', 'spruce_planks');
 * // Returns: true
 * 
 * const areSimilar = areItemsSimilar(mcData, 'oak_planks', 'iron_ingot');
 * // Returns: false
 * ```
 */
export function areItemsSimilar(mcData: MinecraftData, item1: string, item2: string): boolean {
  const similar1 = findSimilarItems(mcData, item1);
  return similar1.includes(item2);
}

/**
 * Gets the suffix token for an item name
 * 
 * This is a convenience function that re-exports getSuffixTokenFromName
 * for use within the item similarity module.
 * 
 * @param itemName - Item name to get suffix for
 * @returns Suffix token or null if no suffix found
 * 
 * @example
 * ```typescript
 * const suffix = getItemSuffix('oak_planks');
 * // Returns: 'planks'
 * 
 * const suffix = getItemSuffix('iron_ingot');
 * // Returns: 'ingot'
 * ```
 */
export function getItemSuffix(itemName: string): string | null {
  return getSuffixTokenFromName(itemName);
}

/**
 * Checks if an item suffix is combinable with other items
 * 
 * @param suffix - Suffix to check
 * @returns True if items with this suffix can be combined
 * 
 * @example
 * ```typescript
 * const isCombinable = isCombinableSuffix('planks');
 * // Returns: true
 * 
 * const isCombinable = isCombinableSuffix('ingot');
 * // Returns: false
 * ```
 */
export function isCombinableSuffix(suffix: string): boolean {
  return COMBINABLE_SUFFIXES.has(suffix);
}
