/**
 * Item similarity utilities
 * 
 * Provides functions for finding similar items that can be used interchangeably
 * in recipes (e.g., different wood types like oak_planks, spruce_planks).
 */

import { MinecraftData, MinecraftItem } from '../types';
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

const WOOD_VARIANT_BASES = new Set([
  'oak',
  'spruce',
  'birch',
  'jungle',
  'acacia',
  'dark_oak',
  'mangrove',
  'cherry',
  'bamboo',
  'crimson',
  'warped'
]);

function getNameWithoutSuffix(itemName: string): string | null {
  const idx = itemName.lastIndexOf('_');
  if (idx === -1) {
    return null;
  }
  return itemName.slice(0, idx);
}

function normalizeVariantBase(nameWithoutSuffix: string | null): string | null {
  if (!nameWithoutSuffix) {
    return null;
  }
  if (nameWithoutSuffix.startsWith('stripped_')) {
    return nameWithoutSuffix.slice('stripped_'.length);
  }
  return nameWithoutSuffix;
}

function isWoodVariant(itemName: string): boolean {
  const base = normalizeVariantBase(getNameWithoutSuffix(itemName));
  return base ? WOOD_VARIANT_BASES.has(base) : false;
}

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
  
  if (!COMBINABLE_SUFFIXES.has(suffix)) {
    return [itemName];
  }
  
  const itemData = mcData.itemsByName[itemName] as MinecraftItem | undefined;
  const tags = (itemData && (itemData as any).tags) ? new Set((itemData as any).tags) : null;

  const restrictToWood = isWoodVariant(itemName);

  const similar: string[] = [];
  for (const [name, data] of Object.entries(mcData.itemsByName)) {
    if (getSuffixTokenFromName(name) !== suffix) continue;
    if (restrictToWood && !isWoodVariant(name)) continue;

    if (tags && tags.size > 0) {
      const candidateTags = data && (data as any).tags ? new Set((data as any).tags) : new Set();
      const shared = [...tags].filter(tag => candidateTags.has(tag));
      if (shared.length === 0) continue;
    }

    similar.push(name);
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
 * Finds all blocks that drop the same item as the given block
 * 
 * This is used for mining nodes where different blocks drop the same item
 * (e.g., iron_ore and deepslate_iron_ore both drop raw_iron).
 * 
 * @param mcData - Minecraft data object
 * @param blockName - Name of the block to find similar blocks for
 * @returns Array of block names that drop the same item, or just the original block if no similar blocks found
 * 
 * @example
 * ```typescript
 * const similar = findBlocksWithSameDrop(mcData, 'iron_ore');
 * // Returns: ['iron_ore', 'deepslate_iron_ore']
 * 
 * const similar = findBlocksWithSameDrop(mcData, 'diamond_ore');
 * // Returns: ['diamond_ore', 'deepslate_diamond_ore']
 * ```
 */
export function findBlocksWithSameDrop(mcData: MinecraftData, blockName: string): string[] {
  // Find the block by name
  let targetBlock = null;
  for (const block of Object.values(mcData.blocks)) {
    if (block.name === blockName) {
      targetBlock = block;
      break;
    }
  }
  
  if (!targetBlock || !targetBlock.drops || targetBlock.drops.length === 0) {
    return [blockName];
  }
  
  const primaryDrop = targetBlock.drops[0];
  const targetToolRequirements = targetBlock.harvestTools || {};
  const targetDropCount = targetBlock.drops.length;
  const similar: string[] = [];
  
  // Find all blocks that drop the same primary item AND have the same tool requirements AND same drop count
  for (const block of Object.values(mcData.blocks)) {
    if (block.drops && block.drops.length > 0 && block.drops[0] === primaryDrop) {
      // Check if tool requirements match
      const blockToolRequirements = block.harvestTools || {};
      const toolsMatch = JSON.stringify(targetToolRequirements) === JSON.stringify(blockToolRequirements);
      
      // Check if drop count matches
      const dropCountMatch = block.drops.length === targetDropCount;
      
      if (toolsMatch && dropCountMatch) {
        similar.push(block.name);
      }
    }
  }
  
  return similar.length > 1 ? similar : [blockName];
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

/**
 * Finds similar items within the same family (e.g., only oak variants for oak_planks)
 * 
 * This filters similar items to only those sharing the same family prefix.
 * For example, if you ask for oak_planks, it will only return oak-related items,
 * not spruce or birch planks.
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to find same-family items for
 * @returns Array of items in the same family, or just the original item if none found
 * 
 * @example
 * ```typescript
 * const sameFamily = findSameFamilyItems(mcData, 'oak_planks');
 * // Returns: ['oak_planks'] (not other wood types)
 * 
 * const sameFamily = findSameFamilyItems(mcData, 'oak_log');
 * // Returns: ['oak_log'] (not spruce_log or birch_log)
 * ```
 */
export function findSameFamilyItems(mcData: MinecraftData, itemName: string): string[] {
  const suffix = getSuffixTokenFromName(itemName);
  if (!suffix || !COMBINABLE_SUFFIXES.has(suffix)) {
    return [itemName];
  }
  
  // Get the family (e.g., "oak" from "oak_planks")
  const family = normalizeVariantBase(getNameWithoutSuffix(itemName));
  if (!family) {
    return [itemName];
  }
  
  // Only return items with the same family and suffix
  const sameFamily: string[] = [];
  for (const [name] of Object.entries(mcData.itemsByName)) {
    if (getSuffixTokenFromName(name) !== suffix) continue;
    
    const nameFamily = normalizeVariantBase(getNameWithoutSuffix(name));
    if (nameFamily === family) {
      sameFamily.push(name);
    }
  }
  
  return sameFamily.length > 0 ? sameFamily : [itemName];
}
