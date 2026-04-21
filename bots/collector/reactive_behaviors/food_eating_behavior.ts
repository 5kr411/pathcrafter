/**
 * Food eating reactive behavior (factory form).
 *
 * Eats food when health or hunger are below thresholds. Cooldown state
 * (per-success / per-failure) is per-factory, not module-global.
 */

import {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  StateBehavior
} from 'mineflayer-statemachine';

import { ReactiveBehavior, Bot } from './types';
import { isWorkstationLocked } from '../../../utils/workstationLock';
import logger from '../../../utils/logger';
import {
  getFoodItems,
  selectBestFood,
  hasNegativeEffects,
  type FoodItem
} from '../../agent_bot/tools/impl/helpers/eat';

const FOOD_EATING_PRIORITY = 60;
const EATING_SUCCESS_COOLDOWN_MS = 3000;
const EATING_FAILURE_COOLDOWN_MS = 15000;

export interface FoodEatingOptions {
  successCooldownMs?: number;
  failureCooldownMs?: number;
}

export interface FoodEatingHandle {
  behavior: ReactiveBehavior;
  resetCooldown(): void;
  isInCooldown(): boolean;
}

function getBotHealth(bot: Bot): number {
  return (bot as any).health ?? 20;
}

function getBotFood(bot: Bot): number {
  return (bot as any).food ?? 20;
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

function canEatFood(bot: Bot, food: FoodItem): boolean {
  // Don't eat foods with negative effects unless health is below full
  if (hasNegativeEffects(food) && isFullHealth(bot)) {
    return false;
  }

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

  return selectBestFood(eatableFoods);
}

function stopBotActions(bot: Bot): void {
  try {
    if (typeof (bot as any)?.clearControlStates === 'function') {
      (bot as any).clearControlStates();
    }
    const pathfinder = (bot as any)?.pathfinder;
    if (pathfinder && typeof pathfinder.stop === 'function') {
      pathfinder.stop();
    }
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
      // Clear any active item use (shield, etc.) before eating
      try {
        if (typeof this.bot.deactivateItem === 'function') {
          this.bot.deactivateItem();
        }
      } catch (_) {}

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

export function createFoodEatingBehavior(opts: FoodEatingOptions = {}): FoodEatingHandle {
  const successCooldownMs = opts.successCooldownMs ?? EATING_SUCCESS_COOLDOWN_MS;
  const failureCooldownMs = opts.failureCooldownMs ?? EATING_FAILURE_COOLDOWN_MS;
  let lastEatAttempt = 0;

  function isOnCooldown(): boolean {
    return Date.now() < lastEatAttempt;
  }

  function setCooldown(durationMs: number): void {
    lastEatAttempt = Date.now() + Math.max(0, durationMs);
  }

  function resetCooldown(): void {
    lastEatAttempt = 0;
  }

  function shouldEat(bot: Bot): boolean {
    if (isOnCooldown()) {
      return false;
    }

    const hunger = getBotFood(bot);
    const health = getBotHealth(bot);

    // If both health and hunger are full, no need to eat
    if (hunger >= 20 && health >= 20) {
      return false;
    }

    // If hunger is full but health isn't, can't eat (Minecraft won't allow it)
    if (hunger >= 20) {
      return false;
    }

    // Always eat if health is below full and hunger is below full
    if (health < 20 && hunger < 20) {
      const bestFood = findBestEatableFood(bot);
      return bestFood !== null;
    }

    // Health is full — eat as soon as the smallest food item in inventory
    // would not be wasted (hunger room >= its food points)
    const allFoods = getFoodItems(bot);
    if (allFoods.length === 0) {
      return false;
    }
    const minFoodPoints = Math.min(...allFoods.map(f => f.foodInfo.foodPoints));
    const hungerRoom = 20 - hunger;
    if (hungerRoom < minFoodPoints) {
      return false;
    }

    return findBestEatableFood(bot) !== null;
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
        const success = eatFood.wasSuccessful();
        if (success) {
          setCooldown(successCooldownMs);
        } else {
          setCooldown(failureCooldownMs);
        }
        logger.debug(`FoodEating: eat finished, success=${success}`);
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

  const behavior: ReactiveBehavior = {
    priority: FOOD_EATING_PRIORITY,
    name: 'food_eating',

    shouldActivate: (bot: Bot): boolean => {
      if (isWorkstationLocked()) return false;
      return shouldEat(bot);
    },

    createState: async (bot: Bot) => {
      const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
        ? (bot as any).safeChat.bind(bot)
        : null;

      stopBotActions(bot);
      setCooldown(successCooldownMs);

      const bestFood = findBestEatableFood(bot);

      if (!bestFood) {
        logger.debug('FoodEating: no suitable food found');
        return null;
      }

      logger.info(`FoodEating: eating ${bestFood.item.name} (${bestFood.foodInfo.foodPoints} points, ${bestFood.foodInfo.saturation} saturation)`);

      const targets: EatFoodTargets = {
        food: bestFood,
        sendChat
      };

      const stateMachine = createFoodEatingState(bot, targets);

      return {
        stateMachine,
        isFinished: () => (typeof (stateMachine as any).isFinished === 'function' ? (stateMachine as any).isFinished() : false),
        wasSuccessful: () => (typeof (stateMachine as any).wasSuccessful === 'function' ? (stateMachine as any).wasSuccessful() : true)
      };
    }
  };

  return {
    behavior,
    resetCooldown,
    isInCooldown: isOnCooldown
  };
}
