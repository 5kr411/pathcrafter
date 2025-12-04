import { ReactiveBehavior, Bot } from './types';
import { ReactiveBehaviorExecutor } from '../reactive_behavior_executor';
import logger from '../../../utils/logger';

const minecraftData = require('minecraft-data');

const EATING_COOLDOWN_MS = 2000;
const EATING_IN_PROGRESS_COOLDOWN_MS = 500;

let lastEatAttempt = 0;

function isOnCooldown(): boolean {
  return Date.now() < lastEatAttempt;
}

function setCooldown(durationMs: number): void {
  lastEatAttempt = Date.now() + Math.max(0, durationMs);
}

export function resetFoodEatingCooldown(): void {
  lastEatAttempt = 0;
}

interface FoodInfo {
  id: number;
  name: string;
  foodPoints: number;
  saturation: number;
}

interface FoodItem {
  item: any;
  foodInfo: FoodInfo;
}

function getBotHealth(bot: Bot): number {
  const entity: any = bot?.entity;
  if (typeof (bot as any)?.health === 'number' && Number.isFinite((bot as any).health)) {
    return (bot as any).health;
  }
  if (typeof entity?.health === 'number' && Number.isFinite(entity.health)) {
    return entity.health;
  }
  return 20;
}

function getBotFood(bot: Bot): number {
  if (typeof (bot as any)?.food === 'number' && Number.isFinite((bot as any).food)) {
    return (bot as any).food;
  }
  return 20;
}

function isFullHealth(bot: Bot): boolean {
  return getBotHealth(bot) >= 20;
}

function isFullHunger(bot: Bot): boolean {
  return getBotFood(bot) >= 20;
}

function getHungerRoom(bot: Bot): number {
  return 20 - getBotFood(bot);
}

function getFoodDataMap(bot: Bot): Map<string, FoodInfo> {
  const mcData = minecraftData(bot.version);
  const foodMap = new Map<string, FoodInfo>();

  if (!mcData?.foods) {
    return foodMap;
  }

  const foodsArray = mcData.foodsArray || Object.values(mcData.foods);
  for (const food of foodsArray) {
    if (food && typeof food.name === 'string') {
      foodMap.set(food.name, {
        id: food.id,
        name: food.name,
        foodPoints: food.foodPoints || 0,
        saturation: food.saturation || 0
      });
    }
  }

  return foodMap;
}

function getInventoryItems(bot: Bot): any[] {
  const inventory: any = (bot as any)?.inventory;
  if (!inventory) {
    return [];
  }

  try {
    if (typeof inventory.items === 'function') {
      const items = inventory.items();
      if (Array.isArray(items)) {
        return items.filter((item: any) => !!item);
      }
    }
  } catch (err: any) {
    logger.debug(`FoodEating: failed to enumerate inventory items - ${err?.message || err}`);
  }

  const slots = inventory.slots;
  if (!Array.isArray(slots)) {
    return [];
  }

  return slots.filter((item: any) => !!item);
}

function getFoodItems(bot: Bot): FoodItem[] {
  const foodDataMap = getFoodDataMap(bot);
  const inventoryItems = getInventoryItems(bot);
  const foodItems: FoodItem[] = [];

  for (const item of inventoryItems) {
    if (!item || typeof item.name !== 'string') {
      continue;
    }

    const foodInfo = foodDataMap.get(item.name);
    if (foodInfo && foodInfo.foodPoints > 0) {
      foodItems.push({ item, foodInfo });
    }
  }

  return foodItems;
}

function selectFoodForFullHealth(foods: FoodItem[]): FoodItem | null {
  if (foods.length === 0) {
    return null;
  }

  const sorted = [...foods].sort((a, b) => a.foodInfo.foodPoints - b.foodInfo.foodPoints);
  return sorted[0];
}

function selectFoodForHealing(foods: FoodItem[]): FoodItem | null {
  if (foods.length === 0) {
    return null;
  }

  const sorted = [...foods].sort((a, b) => b.foodInfo.saturation - a.foodInfo.saturation);
  return sorted[0];
}

function selectBestFood(bot: Bot, foods: FoodItem[]): FoodItem | null {
  if (foods.length === 0) {
    return null;
  }

  if (isFullHealth(bot)) {
    return selectFoodForFullHealth(foods);
  } else {
    return selectFoodForHealing(foods);
  }
}

function canEatFood(bot: Bot, food: FoodItem): boolean {
  const hungerRoom = getHungerRoom(bot);

  if (hungerRoom >= food.foodInfo.foodPoints) {
    return true;
  }

  if (!isFullHealth(bot) && !isFullHunger(bot)) {
    return true;
  }

  return false;
}

function findBestEatableFood(bot: Bot): FoodItem | null {
  const allFoods = getFoodItems(bot);

  if (allFoods.length === 0) {
    return null;
  }

  const eatableFoods = allFoods.filter(food => canEatFood(bot, food));

  if (eatableFoods.length === 0) {
    return null;
  }

  return selectBestFood(bot, eatableFoods);
}

function shouldEat(bot: Bot): boolean {
  if (isOnCooldown()) {
    return false;
  }

  if (isFullHunger(bot)) {
    return false;
  }

  const bestFood = findBestEatableFood(bot);
  return bestFood !== null;
}

export const foodEatingBehavior: ReactiveBehavior = {
  priority: 50,
  name: 'food_eating',

  shouldActivate: (bot: Bot): boolean => {
    return shouldEat(bot);
  },

  execute: async (bot: Bot, executor: ReactiveBehaviorExecutor): Promise<any> => {
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : null;

    const bestFood = findBestEatableFood(bot);

    if (!bestFood) {
      logger.debug('FoodEating: no suitable food found');
      executor.finish(false);
      return null;
    }

    logger.debug(`FoodEating: attempting to eat ${bestFood.item.name} (${bestFood.foodInfo.foodPoints} points, ${bestFood.foodInfo.saturation} saturation)`);
    setCooldown(EATING_IN_PROGRESS_COOLDOWN_MS);

    try {
      await (bot as any).equip(bestFood.item, 'hand');

      const heldItem = (bot as any)?.heldItem;
      if (!heldItem || heldItem.name !== bestFood.item.name) {
        logger.debug(`FoodEating: failed to equip ${bestFood.item.name}`);
        setCooldown(EATING_COOLDOWN_MS);
        executor.finish(false);
        return null;
      }

      await (bot as any).consume();

      logger.info(`FoodEating: ate ${bestFood.item.name}`);
      if (sendChat) {
        sendChat(`ate ${bestFood.item.name}`);
      }

      setCooldown(EATING_COOLDOWN_MS);
      executor.finish(true);
      return null;
    } catch (err: any) {
      logger.debug(`FoodEating: error eating food - ${err?.message || err}`);
      setCooldown(EATING_COOLDOWN_MS);
      executor.finish(false);
      return null;
    }
  },

  onDeactivate: () => {}
};

