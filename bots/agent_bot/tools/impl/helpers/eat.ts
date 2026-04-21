/**
 * Shared eating helpers used by both the reactive `food_eating_behavior`
 * and the synchronous `eat_food` agent tool.
 *
 * Keeps pure evaluation (which foods are in the inventory, which is best)
 * here; side-effect work (equip + consume) is still performed by callers so
 * they can coordinate with their own state machines or cooldowns.
 */

const minecraftData = require('minecraft-data');

export interface FoodInfo {
  id: number;
  name: string;
  foodPoints: number;
  saturation: number;
}

export interface FoodItem {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
  item: any;
  foodInfo: FoodInfo;
}

export const NEGATIVE_EFFECT_FOODS = new Set<string>([
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'chicken',          // raw chicken
  'suspicious_stew'
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function getFoodDataMap(bot: any): Map<string, FoodInfo> {
  const mcData = minecraftData(bot?.version);
  const map = new Map<string, FoodInfo>();
  if (!mcData?.foods) return map;
  const foodsArray = mcData.foodsArray || Object.values(mcData.foods);
  for (const f of foodsArray) {
    if (f && typeof f.name === 'string') {
      map.set(f.name, {
        id: f.id,
        name: f.name,
        foodPoints: f.foodPoints || 0,
        saturation: f.saturation || 0
      });
    }
  }
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function getInventoryItems(bot: any): any[] {
  const inv = bot?.inventory;
  if (!inv || typeof inv.items !== 'function') return [];
  try {
    const items = inv.items();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    return Array.isArray(items) ? items.filter((i: any) => !!i) : [];
  } catch (_) {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function getFoodItems(bot: any): FoodItem[] {
  const map = getFoodDataMap(bot);
  const out: FoodItem[] = [];
  for (const item of getInventoryItems(bot)) {
    if (!item || typeof item.name !== 'string') continue;
    const info = map.get(item.name);
    if (info && info.foodPoints > 0) out.push({ item, foodInfo: info });
  }
  return out;
}

export function hasNegativeEffects(food: FoodItem): boolean {
  return NEGATIVE_EFFECT_FOODS.has(food.item.name);
}

export function selectBestFood(foods: FoodItem[]): FoodItem | null {
  if (foods.length === 0) return null;
  const sorted = [...foods].sort((a, b) => b.foodInfo.saturation - a.foodInfo.saturation);
  return sorted[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function findBestSafeFood(bot: any): FoodItem | null {
  const foods = getFoodItems(bot);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
  const health = (bot as any).health ?? 20;
  const eligible = foods.filter(f => !(hasNegativeEffects(f) && health >= 20));
  return selectBestFood(eligible);
}

/**
 * Equip + consume a specific food item. Returns success flag.
 * Leaves error reporting to the caller.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export async function eatFoodItem(bot: any, food: FoodItem): Promise<boolean> {
  try {
    try { bot.deactivateItem?.(); } catch (_) {}
    await bot.equip(food.item, 'hand');
    const held = bot?.heldItem;
    if (!held || held.name !== food.item.name) return false;
    await bot.consume();
    return true;
  } catch (_) {
    return false;
  }
}
