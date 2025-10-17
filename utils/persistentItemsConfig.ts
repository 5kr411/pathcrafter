/**
 * Configuration for persistent items in Minecraft
 * 
 * Persistent items are items that can be reused after being crafted
 * and don't get consumed during use (within reasonable durability limits).
 * These are primarily tools, workstations, and armor.
 * 
 * This list is used by path optimizations to deduplicate redundant crafts.
 */

/**
 * All workstations that persist after crafting
 */
const PERSISTENT_WORKSTATIONS = [
  'crafting_table',
  'furnace',
  'blast_furnace',
  'smoker',
  'anvil',
  'smithing_table',
  'enchanting_table',
  'brewing_stand',
  'cauldron',
  'loom',
  'cartography_table',
  'grindstone',
  'stonecutter',
] as const;

/**
 * All tools (pickaxes, axes, shovels, hoes, swords) across all tiers
 */
const PERSISTENT_TOOLS = [
  // Wooden tier
  'wooden_pickaxe',
  'wooden_axe',
  'wooden_shovel',
  'wooden_hoe',
  'wooden_sword',
  
  // Stone tier
  'stone_pickaxe',
  'stone_axe',
  'stone_shovel',
  'stone_hoe',
  'stone_sword',
  
  // Iron tier
  'iron_pickaxe',
  'iron_axe',
  'iron_shovel',
  'iron_hoe',
  'iron_sword',
  
  // Golden tier
  'golden_pickaxe',
  'golden_axe',
  'golden_shovel',
  'golden_hoe',
  'golden_sword',
  
  // Diamond tier
  'diamond_pickaxe',
  'diamond_axe',
  'diamond_shovel',
  'diamond_hoe',
  'diamond_sword',
  
  // Netherite tier
  'netherite_pickaxe',
  'netherite_axe',
  'netherite_shovel',
  'netherite_hoe',
  'netherite_sword',
] as const;

/**
 * All armor pieces across all tiers
 */
const PERSISTENT_ARMOR = [
  // Leather armor
  'leather_helmet',
  'leather_chestplate',
  'leather_leggings',
  'leather_boots',
  
  // Chainmail armor
  'chainmail_helmet',
  'chainmail_chestplate',
  'chainmail_leggings',
  'chainmail_boots',
  
  // Iron armor
  'iron_helmet',
  'iron_chestplate',
  'iron_leggings',
  'iron_boots',
  
  // Golden armor
  'golden_helmet',
  'golden_chestplate',
  'golden_leggings',
  'golden_boots',
  
  // Diamond armor
  'diamond_helmet',
  'diamond_chestplate',
  'diamond_leggings',
  'diamond_boots',
  
  // Netherite armor
  'netherite_helmet',
  'netherite_chestplate',
  'netherite_leggings',
  'netherite_boots',
] as const;

/**
 * Other reusable items that persist after crafting
 */
const PERSISTENT_OTHER = [
  'bucket',
  'water_bucket',
  'lava_bucket',
  'milk_bucket',
  'powder_snow_bucket',
  'shears',
  'flint_and_steel',
  'fishing_rod',
  'bow',
  'crossbow',
  'shield',
  'compass',
  'clock',
  'spyglass',
  'lead',
  'name_tag',
  'saddle',
  'elytra',
  'trident',
] as const;

/**
 * Combined set of all persistent items for efficient lookup
 */
const PERSISTENT_ITEMS_SET: Set<string> = new Set([
  ...PERSISTENT_WORKSTATIONS,
  ...PERSISTENT_TOOLS,
  ...PERSISTENT_ARMOR,
  ...PERSISTENT_OTHER,
]);

/**
 * Checks if an item is persistent (can be reused after crafting)
 * 
 * @param itemName - Name of the item to check
 * @returns true if the item persists and can be reused
 * 
 * @example
 * isPersistentItem('crafting_table') // true
 * isPersistentItem('wooden_pickaxe') // true
 * isPersistentItem('oak_planks') // false
 * isPersistentItem('stick') // false
 */
export function isPersistentItem(itemName: string): boolean {
  return PERSISTENT_ITEMS_SET.has(itemName);
}

/**
 * Gets all persistent workstation names
 */
export function getPersistentWorkstations(): readonly string[] {
  return PERSISTENT_WORKSTATIONS;
}

/**
 * Gets all persistent tool names
 */
export function getPersistentTools(): readonly string[] {
  return PERSISTENT_TOOLS;
}

/**
 * Gets all persistent armor names
 */
export function getPersistentArmor(): readonly string[] {
  return PERSISTENT_ARMOR;
}

/**
 * Gets all persistent items as an array
 */
export function getAllPersistentItems(): string[] {
  return Array.from(PERSISTENT_ITEMS_SET);
}

/**
 * Checks if an item is a persistent workstation
 */
export function isWorkstation(itemName: string): boolean {
  return PERSISTENT_WORKSTATIONS.includes(itemName as any);
}

/**
 * Checks if an item is a persistent tool
 */
export function isTool(itemName: string): boolean {
  return PERSISTENT_TOOLS.includes(itemName as any);
}

/**
 * Checks if an item is persistent armor
 */
export function isArmor(itemName: string): boolean {
  return PERSISTENT_ARMOR.includes(itemName as any);
}

