import {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  StateBehavior
} from 'mineflayer-statemachine';

import { ReactiveBehavior, Bot } from './types';
import { ReactiveBehaviorExecutor } from '../reactive_behavior_executor';
import logger from '../../../utils/logger';

const minecraftData = require('minecraft-data');

const EATING_COOLDOWN_MS = 3000;

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

function stopBotActions(bot: Bot): void {
  try {
    if (typeof (bot as any)?.clearControlStates === 'function') {
      (bot as any).clearControlStates();
    }
  } catch (_) {}

  try {
    const pathfinder = (bot as any)?.pathfinder;
    if (pathfinder && typeof pathfinder.stop === 'function') {
      pathfinder.stop();
    }
  } catch (_) {}

  try {
    if (typeof (bot as any)?.stopDigging === 'function') {
      (bot as any).stopDigging();
    }
  } catch (_) {}
}

interface EatFoodTargets {
  food: FoodItem | null;
  sendChat: ((msg: string) => void) | null;
}

class BehaviorEatFood implements StateBehavior {
  public stateName = 'EatFood';
  public active = false;
  private finished = false;
  private success = false;

  constructor(
    private readonly bot: any,
    private readonly targets: EatFoodTargets
  ) {}

  onStateEntered(): void {
    this.finished = false;
    this.success = false;
    this.active = true;

    this.executeEating();
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean {
    return this.finished;
  }

  wasSuccessful(): boolean {
    return this.success;
  }

  private async executeEating(): Promise<void> {
    const food = this.targets.food;
    if (!food) {
      this.finished = true;
      this.success = false;
      return;
    }

    try {
      await this.bot.equip(food.item, 'hand');

      const heldItem = this.bot?.heldItem;
      if (!heldItem || heldItem.name !== food.item.name) {
        logger.debug(`FoodEating: failed to equip ${food.item.name}`);
        this.finished = true;
        this.success = false;
        return;
      }

      await this.bot.consume();

      logger.info(`FoodEating: ate ${food.item.name}`);
      if (this.targets.sendChat) {
        this.targets.sendChat(`ate ${food.item.name}`);
      }

      this.finished = true;
      this.success = true;
    } catch (err: any) {
      logger.debug(`FoodEating: error eating food - ${err?.message || err}`);
      this.finished = true;
      this.success = false;
    }
  }
}

function createFoodEatingState(bot: Bot, targets: EatFoodTargets): any {
  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();
  const eatFood = new BehaviorEatFood(bot, targets);
  let reachedExit = false;

  const enterToEat = new StateTransition({
    parent: enter,
    child: eatFood,
    name: 'food-eating: enter -> eat',
    shouldTransition: () => true,
    onTransition: () => {
      logger.debug('FoodEating: starting eat state');
    }
  });

  const eatToExit = new StateTransition({
    parent: eatFood,
    child: exit,
    name: 'food-eating: eat -> exit',
    shouldTransition: () => eatFood.isFinished(),
    onTransition: () => {
      reachedExit = true;
      setCooldown(EATING_COOLDOWN_MS);
      logger.debug(`FoodEating: eat finished, success=${eatFood.wasSuccessful()}`);
    }
  });

  const stateMachine = new NestedStateMachine([enterToEat, eatToExit], enter, exit);

  (stateMachine as any).isFinished = () => reachedExit;
  (stateMachine as any).wasSuccessful = () => eatFood.wasSuccessful();

  stateMachine.onStateExited = function() {
    logger.debug('FoodEating: cleaning up on state exit');

    if (eatFood && typeof eatFood.onStateExited === 'function') {
      try {
        eatFood.onStateExited();
      } catch (_) {}
    }

    try {
      bot.clearControlStates?.();
    } catch (_) {}
  };

  return stateMachine;
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

    stopBotActions(bot);
    setCooldown(EATING_COOLDOWN_MS);

    const bestFood = findBestEatableFood(bot);

    if (!bestFood) {
      logger.debug('FoodEating: no suitable food found');
      executor.finish(false);
      return null;
    }

    logger.info(`FoodEating: eating ${bestFood.item.name} (${bestFood.foodInfo.foodPoints} points, ${bestFood.foodInfo.saturation} saturation)`);

    const targets: EatFoodTargets = {
      food: bestFood,
      sendChat
    };

    const stateMachine = createFoodEatingState(bot, targets);

    let finished = false;
    let completionInterval: NodeJS.Timeout | null = null;

    const clearCompletionInterval = () => {
      if (completionInterval) {
        clearInterval(completionInterval);
        completionInterval = null;
      }
    };

    const finishEating = (success: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      clearCompletionInterval();
      executor.finish(success);
    };

    const checkCompletion = () => {
      try {
        if (typeof (stateMachine as any).isFinished === 'function' && (stateMachine as any).isFinished()) {
          const success = typeof (stateMachine as any).wasSuccessful === 'function' 
            ? (stateMachine as any).wasSuccessful() 
            : true;
          finishEating(success);
        }
      } catch (_) {}
    };

    completionInterval = setInterval(checkCompletion, 100);

    const originalOnStateExited = stateMachine.onStateExited;
    stateMachine.onStateExited = function(this: any) {
      clearCompletionInterval();
      if (originalOnStateExited) {
        try {
          originalOnStateExited.call(this);
        } catch (_) {}
      }
      finishEating(true);
    };

    return stateMachine;
  },

  onDeactivate: () => {}
};
