/**
 * Food configuration utility
 * 
 * Centralized food data including hunger points, smelting mappings,
 * and huntable animal definitions for the food collection system.
 */

/**
 * Food item with hunger restoration value
 */
export interface FoodItem {
  name: string;
  hungerPoints: number;
  saturation: number;
  isCooked?: boolean;
  rawVariant?: string;
}

/**
 * Huntable animal definition
 */
export interface HuntableAnimal {
  entity: string;
  drops: string[];
  avgDropCount: number;
}

/**
 * Food smelting mapping (raw -> cooked)
 */
export interface FoodSmeltMapping {
  input: string;
  output: string;
}

/**
 * Food collection configuration
 */
export interface FoodCollectionConfig {
  /**
   * Inventory food points threshold that triggers collection.
   */
  triggerFoodPoints: number;
  /**
   * Inventory food points target to collect up to.
   */
  targetFoodPoints: number;
  /**
   * Backwards-compatible alias for triggerFoodPoints.
   */
  minFoodThreshold?: number;
}

/**
 * Default food collection configuration
 */
export const DEFAULT_FOOD_CONFIG: FoodCollectionConfig = {
  triggerFoodPoints: 20,
  minFoodThreshold: 20,
  targetFoodPoints: 60
};

/**
 * Food items and their hunger point values
 * Values from Minecraft Java Edition
 */
export const FOOD_ITEMS: Record<string, FoodItem> = {
  // Cooked meats (best food sources)
  cooked_beef: { name: 'cooked_beef', hungerPoints: 8, saturation: 12.8, isCooked: true, rawVariant: 'beef' },
  cooked_porkchop: { name: 'cooked_porkchop', hungerPoints: 8, saturation: 12.8, isCooked: true, rawVariant: 'porkchop' },
  cooked_mutton: { name: 'cooked_mutton', hungerPoints: 6, saturation: 9.6, isCooked: true, rawVariant: 'mutton' },
  cooked_chicken: { name: 'cooked_chicken', hungerPoints: 6, saturation: 7.2, isCooked: true, rawVariant: 'chicken' },
  cooked_rabbit: { name: 'cooked_rabbit', hungerPoints: 5, saturation: 6, isCooked: true, rawVariant: 'rabbit' },
  cooked_salmon: { name: 'cooked_salmon', hungerPoints: 6, saturation: 9.6, isCooked: true, rawVariant: 'salmon' },
  cooked_cod: { name: 'cooked_cod', hungerPoints: 5, saturation: 6, isCooked: true, rawVariant: 'cod' },
  
  // Raw meats (can be eaten but should be cooked)
  beef: { name: 'beef', hungerPoints: 3, saturation: 1.8 },
  porkchop: { name: 'porkchop', hungerPoints: 3, saturation: 1.8 },
  mutton: { name: 'mutton', hungerPoints: 2, saturation: 1.2 },
  chicken: { name: 'chicken', hungerPoints: 2, saturation: 1.2 },
  rabbit: { name: 'rabbit', hungerPoints: 3, saturation: 1.8 },
  salmon: { name: 'salmon', hungerPoints: 2, saturation: 0.4 },
  cod: { name: 'cod', hungerPoints: 2, saturation: 0.4 },
  
  // Bread and baked goods
  bread: { name: 'bread', hungerPoints: 5, saturation: 6 },
  baked_potato: { name: 'baked_potato', hungerPoints: 5, saturation: 6, isCooked: true, rawVariant: 'potato' },
  cookie: { name: 'cookie', hungerPoints: 2, saturation: 0.4 },
  pumpkin_pie: { name: 'pumpkin_pie', hungerPoints: 8, saturation: 4.8 },
  cake: { name: 'cake', hungerPoints: 14, saturation: 2.8 },
  
  // Vegetables and fruits
  apple: { name: 'apple', hungerPoints: 4, saturation: 2.4 },
  golden_apple: { name: 'golden_apple', hungerPoints: 4, saturation: 9.6 },
  enchanted_golden_apple: { name: 'enchanted_golden_apple', hungerPoints: 4, saturation: 9.6 },
  carrot: { name: 'carrot', hungerPoints: 3, saturation: 3.6 },
  golden_carrot: { name: 'golden_carrot', hungerPoints: 6, saturation: 14.4 },
  potato: { name: 'potato', hungerPoints: 1, saturation: 0.6 },
  beetroot: { name: 'beetroot', hungerPoints: 1, saturation: 1.2 },
  melon_slice: { name: 'melon_slice', hungerPoints: 2, saturation: 1.2 },
  sweet_berries: { name: 'sweet_berries', hungerPoints: 2, saturation: 0.4 },
  glow_berries: { name: 'glow_berries', hungerPoints: 2, saturation: 0.4 },
  
  // Dried kelp
  dried_kelp: { name: 'dried_kelp', hungerPoints: 1, saturation: 0.6 },
  
  // Stews and soups
  mushroom_stew: { name: 'mushroom_stew', hungerPoints: 6, saturation: 7.2 },
  beetroot_soup: { name: 'beetroot_soup', hungerPoints: 6, saturation: 7.2 },
  rabbit_stew: { name: 'rabbit_stew', hungerPoints: 10, saturation: 12 },
  suspicious_stew: { name: 'suspicious_stew', hungerPoints: 6, saturation: 7.2 },
  
  // Misc
  rotten_flesh: { name: 'rotten_flesh', hungerPoints: 4, saturation: 0.8 },
  spider_eye: { name: 'spider_eye', hungerPoints: 2, saturation: 3.2 },
  honey_bottle: { name: 'honey_bottle', hungerPoints: 6, saturation: 1.2 }
};

/**
 * Huntable land animals and their food drops
 */
export const HUNTABLE_LAND_ANIMALS: HuntableAnimal[] = [
  { entity: 'cow', drops: ['beef'], avgDropCount: 2 },
  { entity: 'pig', drops: ['porkchop'], avgDropCount: 2 },
  { entity: 'sheep', drops: ['mutton'], avgDropCount: 2 },
  { entity: 'chicken', drops: ['chicken'], avgDropCount: 1 },
  { entity: 'rabbit', drops: ['rabbit'], avgDropCount: 1 }
];

/**
 * Huntable water animals and their food drops
 */
export const HUNTABLE_WATER_ANIMALS: HuntableAnimal[] = [
  // disabled until pathfinder supports water navigation
  // { entity: 'salmon', drops: ['salmon'], avgDropCount: 1 },
  // { entity: 'cod', drops: ['cod'], avgDropCount: 1 }
];

/**
 * All huntable animals (land + water)
 */
export const ALL_HUNTABLE_ANIMALS: HuntableAnimal[] = [
  ...HUNTABLE_LAND_ANIMALS,
  ...HUNTABLE_WATER_ANIMALS
];

/**
 * Food smelting mappings (raw -> cooked)
 */
export const FOOD_SMELT_MAPPINGS: FoodSmeltMapping[] = [
  { input: 'beef', output: 'cooked_beef' },
  { input: 'porkchop', output: 'cooked_porkchop' },
  { input: 'mutton', output: 'cooked_mutton' },
  { input: 'chicken', output: 'cooked_chicken' },
  { input: 'rabbit', output: 'cooked_rabbit' },
  { input: 'salmon', output: 'cooked_salmon' },
  { input: 'cod', output: 'cooked_cod' },
  { input: 'potato', output: 'baked_potato' },
  { input: 'kelp', output: 'dried_kelp' }
];

/**
 * Preferred food targets for collection (in priority order)
 * These are the cooked versions that the planner should target
 */
export const PREFERRED_FOOD_TARGETS: string[] = [
  'cooked_beef',
  'cooked_porkchop',
  'cooked_mutton',
  'cooked_chicken',
  'cooked_salmon',
  'cooked_cod',
  'bread',
  'baked_potato',
  'dried_kelp',
  'sweet_berries',
  'glow_berries'
];

/**
 * Weapons sufficient for hunting (in order of preference)
 */
export const HUNTING_WEAPONS: string[] = [
  'netherite_sword',
  'diamond_sword',
  'iron_sword',
  'stone_sword',
  'golden_sword',
  'wooden_sword'
];

/**
 * Minimum acceptable weapons for hunting
 */
export const MIN_HUNTING_WEAPONS: string[] = [
  'netherite_sword',
  'diamond_sword',
  'iron_sword',
  'stone_sword'
];

/**
 * Gets hunger points for a food item
 */
export function getFoodHungerPoints(itemName: string): number {
  const food = FOOD_ITEMS[itemName];
  return food ? food.hungerPoints : 0;
}

/**
 * Gets saturation for a food item
 */
export function getFoodSaturation(itemName: string): number {
  const food = FOOD_ITEMS[itemName];
  return food ? food.saturation : 0;
}

/**
 * Checks if an item is a food item
 */
export function isFood(itemName: string): boolean {
  return itemName in FOOD_ITEMS;
}

/**
 * Checks if a food item is cooked
 */
export function isCookedFood(itemName: string): boolean {
  const food = FOOD_ITEMS[itemName];
  return food?.isCooked === true;
}

/**
 * Gets the raw variant of a cooked food item
 */
export function getRawVariant(cookedItemName: string): string | null {
  const food = FOOD_ITEMS[cookedItemName];
  return food?.rawVariant || null;
}

/**
 * Gets the cooked variant of a raw food item
 */
export function getCookedVariant(rawItemName: string): string | null {
  const mapping = FOOD_SMELT_MAPPINGS.find(m => m.input === rawItemName);
  return mapping?.output || null;
}

/**
 * Calculates total hunger points from an inventory object
 */
export function calculateFoodPointsInInventory(inventory: Record<string, number>): number {
  let total = 0;
  for (const [itemName, count] of Object.entries(inventory)) {
    const hungerPoints = getFoodHungerPoints(itemName);
    if (hungerPoints > 0 && count > 0) {
      total += hungerPoints * count;
    }
  }
  return total;
}

/**
 * Gets food items from an inventory object
 */
export function getFoodItemsFromInventory(inventory: Record<string, number>): Array<{ name: string; count: number; hungerPoints: number }> {
  const foodItems: Array<{ name: string; count: number; hungerPoints: number }> = [];
  for (const [itemName, count] of Object.entries(inventory)) {
    const hungerPoints = getFoodHungerPoints(itemName);
    if (hungerPoints > 0 && count > 0) {
      foodItems.push({ name: itemName, count, hungerPoints });
    }
  }
  return foodItems.sort((a, b) => b.hungerPoints - a.hungerPoints);
}

/**
 * Checks if bot has a suitable weapon for hunting
 */
export function hasHuntingWeapon(inventory: Record<string, number>): boolean {
  return MIN_HUNTING_WEAPONS.some(weapon => (inventory[weapon] || 0) > 0);
}

/**
 * Gets the best hunting weapon from inventory
 */
export function getBestHuntingWeapon(inventory: Record<string, number>): string | null {
  for (const weapon of HUNTING_WEAPONS) {
    if ((inventory[weapon] || 0) > 0) {
      return weapon;
    }
  }
  return null;
}

/**
 * Calculates how many of a food item are needed to reach target hunger points
 */
export function calculateFoodNeeded(targetPoints: number, currentPoints: number, foodItemName: string): number {
  const hungerPerItem = getFoodHungerPoints(foodItemName);
  if (hungerPerItem <= 0) return 0;
  
  const pointsNeeded = Math.max(0, targetPoints - currentPoints);
  return Math.ceil(pointsNeeded / hungerPerItem);
}

/**
 * Selects the best food target based on available entities in world snapshot
 */
export function selectBestFoodTarget(
  availableEntities: Set<string>,
  availableBlocks: Set<string>
): string | null {
  // Check for hay bales (wheat -> bread)
  if (availableBlocks.has('hay_block')) {
    return 'bread';
  }
  
  // Check for huntable land animals (prefer larger drops)
  for (const animal of HUNTABLE_LAND_ANIMALS) {
    if (availableEntities.has(animal.entity)) {
      const cookedDrop = getCookedVariant(animal.drops[0]);
      if (cookedDrop) {
        return cookedDrop;
      }
    }
  }
  
  // Check for fish
  if (availableEntities.has('salmon') || availableBlocks.has('salmon')) {
    return 'cooked_salmon';
  }
  if (availableEntities.has('cod') || availableBlocks.has('cod')) {
    return 'cooked_cod';
  }
  
  // Check for kelp
  if (availableBlocks.has('kelp') || availableBlocks.has('kelp_plant')) {
    return 'dried_kelp';
  }
  
  // Default to cooked beef if no specific resources found
  return 'cooked_beef';
}

/**
 * Gets the entity name that drops a specific raw food item
 */
export function getEntityForFoodDrop(rawFoodItem: string): string | null {
  const animal = ALL_HUNTABLE_ANIMALS.find(a => a.drops.includes(rawFoodItem));
  return animal?.entity || null;
}
