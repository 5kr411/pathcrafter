/**
 * Source lookup utilities
 * 
 * Provides functions for finding blocks and mobs that drop specific items.
 * This is used to determine mining and hunting sources for item acquisition.
 */

import { MinecraftData, BlockSource, MobSource } from '../types';

/**
 * Finds blocks that drop a specific item
 * 
 * Searches through all blocks in the Minecraft data to find those that
 * drop the specified item when mined.
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to find sources for
 * @returns Array of block sources that drop the item
 * 
 * @example
 * ```typescript
 * const sources = findBlocksThatDrop(mcData, 'coal');
 * // Returns: [
 * //   { block: 'coal_ore', tool: 'wooden_pickaxe/stone_pickaxe/iron_pickaxe/diamond_pickaxe/netherite_pickaxe' },
 * //   { block: 'deepslate_coal_ore', tool: 'wooden_pickaxe/stone_pickaxe/iron_pickaxe/diamond_pickaxe/netherite_pickaxe' }
 * // ]
 * ```
 */
export function findBlocksThatDrop(mcData: MinecraftData, itemName: string): BlockSource[] {
  const sources: BlockSource[] = [];
  const item = mcData.itemsByName[itemName];
  if (!item) return sources;

  Object.values(mcData.blocks).forEach(block => {
    if (block.drops && block.drops.includes(item.id)) {
      sources.push({
        block: block.name,
        tool: block.harvestTools && Object.keys(block.harvestTools).length > 0
          ? Object.keys(block.harvestTools).map(id => mcData.items[Number(id)]?.name || id).join('/')
          : 'any'
      });
    }
  });

  return sources;
}

/**
 * Finds mobs that drop a specific item
 * 
 * Searches through all entity loot tables to find mobs that drop
 * the specified item when killed.
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to find sources for
 * @returns Array of mob sources that drop the item
 * 
 * @example
 * ```typescript
 * const sources = findMobsThatDrop(mcData, 'feather');
 * // Returns: [
 * //   { mob: 'chicken', dropChance: 0.125 }
 * // ]
 * ```
 */
export function findMobsThatDrop(mcData: MinecraftData, itemName: string): MobSource[] {
  const sources: MobSource[] = [];
  const item = mcData.itemsByName[itemName];
  if (!item) return sources;

  Object.entries(mcData.entityLoot || {}).forEach(([_entityId, lootTable]) => {
    if (lootTable && lootTable.drops) {
      const hasItem = lootTable.drops.some(drop => {
        const dropItemName = drop.item?.toLowerCase().replace(' ', '_');
        return dropItemName === itemName;
      });
      if (hasItem) {
        sources.push({
          mob: lootTable.entity,
          dropChance: lootTable.drops.find(d => d.item?.toLowerCase().replace(' ', '_') === itemName)?.dropChance
        });
      }
    }
  });

  return sources;
}

/**
 * Gets all possible sources (blocks and mobs) for an item
 * 
 * Combines block and mob sources into a single result for convenience.
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to find sources for
 * @returns Object containing both block and mob sources
 * 
 * @example
 * ```typescript
 * const sources = getAllSourcesForItem(mcData, 'string');
 * // Returns: {
 * //   blocks: [{ block: 'cobweb', tool: 'any' }],
 * //   mobs: [{ mob: 'spider', dropChance: 0.125 }]
 * // }
 * ```
 */
export function getAllSourcesForItem(mcData: MinecraftData, itemName: string): {
  blocks: BlockSource[];
  mobs: MobSource[];
} {
  return {
    blocks: findBlocksThatDrop(mcData, itemName),
    mobs: findMobsThatDrop(mcData, itemName)
  };
}

/**
 * Checks if an item can be obtained from blocks
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to check
 * @returns True if the item can be obtained by mining blocks
 * 
 * @example
 * ```typescript
 * const canMine = canObtainFromBlocks(mcData, 'coal');
 * // Returns: true
 * 
 * const canMine = canObtainFromBlocks(mcData, 'feather');
 * // Returns: false
 * ```
 */
export function canObtainFromBlocks(mcData: MinecraftData, itemName: string): boolean {
  return findBlocksThatDrop(mcData, itemName).length > 0;
}

/**
 * Checks if an item can be obtained from mobs
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to check
 * @returns True if the item can be obtained by hunting mobs
 * 
 * @example
 * ```typescript
 * const canHunt = canObtainFromMobs(mcData, 'feather');
 * // Returns: true
 * 
 * const canHunt = canObtainFromMobs(mcData, 'coal');
 * // Returns: false
 * ```
 */
export function canObtainFromMobs(mcData: MinecraftData, itemName: string): boolean {
  return findMobsThatDrop(mcData, itemName).length > 0;
}

/**
 * Gets the best tool for mining a specific block
 * 
 * @param mcData - Minecraft data object
 * @param blockName - Name of the block to mine
 * @returns The best tool name, or 'any' if no specific tool required
 * 
 * @example
 * ```typescript
 * const tool = getBestToolForBlock(mcData, 'coal_ore');
 * // Returns: 'wooden_pickaxe' (lowest tier that works)
 * ```
 */
export function getBestToolForBlock(mcData: MinecraftData, blockName: string): string {
  const block = Object.values(mcData.blocks).find(b => b.name === blockName);
  if (!block || !block.harvestTools) return 'any';

  // Return the first (lowest tier) tool that can harvest this block
  const toolIds = Object.keys(block.harvestTools);
  if (toolIds.length === 0) return 'any';

  const toolId = Number(toolIds[0]);
  return mcData.items[toolId]?.name || 'any';
}
