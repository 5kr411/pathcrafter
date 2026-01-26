/**
 * Source lookup utilities
 * 
 * Provides functions for finding blocks and mobs that drop specific items.
 * This is used to determine mining and hunting sources for item acquisition.
 */

import { MinecraftData, BlockSource, MobSource } from '../types';

/**
 * Configuration for a secondary block drop.
 * Used for items that can be obtained from blocks but aren't in minecraft-data's drops array.
 */
export interface SecondaryBlockDrop {
  /** The block that drops this item */
  block: string;
  /** Tool required to harvest (or 'any' for no tool requirement) */
  tool: string;
  /** Drop chance (0.0 to 1.0). 1.0 = guaranteed, 0.1 = 10% chance */
  dropChance: number;
  /** Average items dropped per block (accounting for variable drop amounts) */
  avgDropsPerBlock: number;
  /** Description of why this is a secondary drop (for documentation) */
  reason: string;
}

/**
 * Secondary block drops configuration.
 * 
 * This handles items that minecraft-data doesn't properly map to blocks, including:
 * - Blocks with special harvest mechanics (right-click berries)
 * - Probabilistic drops (flint from gravel)
 * - Fortune-affected drops where base isn't tracked
 * 
 * Maps item name -> array of block sources that can drop it.
 */
export const SECONDARY_BLOCK_DROPS: Record<string, SecondaryBlockDrop[]> = {
  // Berries - harvested by right-click interaction, not in minecraft-data drops
  sweet_berries: [{
    block: 'sweet_berry_bush',
    tool: 'any',
    dropChance: 1.0,
    avgDropsPerBlock: 2.5, // drops 2-3 berries when fully grown
    reason: 'Right-click harvest mechanic not in minecraft-data'
  }],
  glow_berries: [
    {
      block: 'cave_vines',
      tool: 'any',
      dropChance: 1.0,
      avgDropsPerBlock: 1.0,
      reason: 'Right-click harvest mechanic not in minecraft-data'
    },
    {
      block: 'cave_vines_plant',
      tool: 'any',
      dropChance: 1.0,
      avgDropsPerBlock: 1.0,
      reason: 'Right-click harvest mechanic not in minecraft-data'
    }
  ],

  // Probabilistic drops - block can drop different items
  flint: [{
    block: 'gravel',
    tool: 'any',
    dropChance: 0.1, // 10% base chance (increases with Fortune)
    avgDropsPerBlock: 0.1,
    reason: 'Gravel has 10% chance to drop flint instead of gravel'
  }],

  // Seeds from grass - probabilistic
  wheat_seeds: [{
    block: 'grass',
    tool: 'any',
    dropChance: 0.125, // 12.5% chance
    avgDropsPerBlock: 0.125,
    reason: 'Grass has 12.5% chance to drop seeds'
  }]
};

/**
 * Reverse lookup: block name -> items it can drop (for variantResolver)
 * Built from SECONDARY_BLOCK_DROPS for consistency.
 */
export const SECONDARY_BLOCK_TO_ITEMS: Record<string, string[]> = (() => {
  const result: Record<string, string[]> = {};
  for (const [itemName, drops] of Object.entries(SECONDARY_BLOCK_DROPS)) {
    for (const drop of drops) {
      if (!result[drop.block]) {
        result[drop.block] = [];
      }
      if (!result[drop.block].includes(itemName)) {
        result[drop.block].push(itemName);
      }
    }
  }
  return result;
})();

/**
 * Gets the expected number of blocks to mine to get a target item count.
 * Accounts for drop chance and average drops per block.
 * 
 * @param itemName - The item to collect
 * @param targetCount - How many items needed
 * @returns Expected blocks to mine, or null if not a secondary drop
 */
export function getExpectedBlocksForItem(itemName: string, targetCount: number): number | null {
  const drops = SECONDARY_BLOCK_DROPS[itemName];
  if (!drops || drops.length === 0) return null;
  
  // Use the best source (highest avgDropsPerBlock)
  const bestSource = drops.reduce((best, current) => 
    current.avgDropsPerBlock > best.avgDropsPerBlock ? current : best
  );
  
  if (bestSource.avgDropsPerBlock <= 0) return null;
  
  // Calculate expected blocks needed
  return Math.ceil(targetCount / bestSource.avgDropsPerBlock);
}

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

  // Check secondary block drops configuration
  const secondaryDrops = SECONDARY_BLOCK_DROPS[itemName];
  if (secondaryDrops) {
    for (const drop of secondaryDrops) {
      // Verify block exists in mcData
      const blockExists = Object.values(mcData.blocks).some((b: any) => b.name === drop.block);
      if (blockExists) {
        sources.push({
          block: drop.block,
          tool: drop.tool
        });
      }
    }
  }

  // Also check standard drops from minecraft-data
  Object.values(mcData.blocks).forEach(block => {
    if (block.drops && block.drops.includes(item.id)) {
      // Avoid duplicates if block is already in sources from secondary drops
      const alreadyAdded = sources.some(s => s.block === block.name);
      if (!alreadyAdded) {
        sources.push({
          block: block.name,
          tool: block.harvestTools && Object.keys(block.harvestTools).length > 0
            ? Object.keys(block.harvestTools).map(id => mcData.items[Number(id)]?.name || id).join('/')
            : 'any'
        });
      }
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
