/**
 * Food collection reactive behavior
 * 
 * Monitors the bot's food inventory and triggers food acquisition
 * when supplies run low. Uses behaviorGetFood for the actual collection.
 */

import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import { isWorkstationLocked } from '../../../utils/workstationLock';
import { getInventoryObject } from '../../../utils/inventory';
import {
  calculateFoodPointsInInventory,
  DEFAULT_FOOD_CONFIG,
  FoodCollectionConfig
} from '../../../utils/foodConfig';
import { captureAdaptiveSnapshot } from '../../../utils/adaptiveSnapshot';
import createGetFoodState from '../../../behaviors/behaviorGetFood';
import logger from '../../../utils/logger';

const FOOD_COLLECTION_PRIORITY = 50;
const DEFAULT_COOLDOWN_MS = 1_200_000; // 20 minute cooldown after failed collection (prevents churn when food is scarce)
const EMERGENCY_HUNGER_THRESHOLD = 6; // bot.food <= this bypasses cooldown (can't sprint, health regen blocked)
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000; // Only log "should activate" every 10s

let foodCollectionConfig: FoodCollectionConfig = { ...DEFAULT_FOOD_CONFIG };
let lastFailedAttempt = Date.now(); // Start in cooldown to delay first run after join
let cooldownMs = DEFAULT_COOLDOWN_MS;
let lastThrottledLogTime = 0;
let foodCollectionActive = false;

function getTriggerThreshold(): number {
  const trigger = Number(foodCollectionConfig.triggerFoodPoints);
  if (Number.isFinite(trigger)) {
    return trigger;
  }
  return DEFAULT_FOOD_CONFIG.triggerFoodPoints;
}

/**
 * Updates the food collection configuration
 */
export function setFoodCollectionConfig(config: Partial<FoodCollectionConfig>): void {
  foodCollectionConfig = { ...foodCollectionConfig, ...config };
  if (
    Number.isFinite(config.minFoodThreshold) &&
    !Number.isFinite(config.triggerFoodPoints as number)
  ) {
    foodCollectionConfig.triggerFoodPoints = Number(config.minFoodThreshold);
  }
}

/**
 * Gets the current food collection configuration
 */
export function getFoodCollectionConfig(): FoodCollectionConfig {
  return { ...foodCollectionConfig };
}

/**
 * Resets the food collection configuration to defaults
 */
export function resetFoodCollectionConfig(): void {
  foodCollectionConfig = { ...DEFAULT_FOOD_CONFIG };
}

/**
 * Sets the cooldown duration after failed food collection attempts
 */
export function setFoodCollectionCooldown(ms: number): void {
  cooldownMs = ms;
}

/**
 * Resets the cooldown timer (call after food sources become available)
 */
export function resetFoodCollectionCooldown(): void {
  lastFailedAttempt = 0;
}

/**
 * Triggers the cooldown timer as if collection just failed
 */
export function triggerFoodCollectionCooldown(): void {
  lastFailedAttempt = Date.now();
}

/**
 * Checks if currently in cooldown period
 */
export function isFoodCollectionInCooldown(): boolean {
  if (lastFailedAttempt === 0) return false;
  return Date.now() - lastFailedAttempt < cooldownMs;
}

/**
 * Checks if food collection is currently running
 */
export function isFoodCollectionActive(): boolean {
  return foodCollectionActive;
}

/**
 * Calculates total food points in the bot's inventory
 */
function getBotFoodPoints(bot: Bot): number {
  const inventory = getInventoryObject(bot as any);
  return calculateFoodPointsInInventory(inventory);
}

export const foodCollectionBehavior: ReactiveBehavior = {
  priority: FOOD_COLLECTION_PRIORITY,
  name: 'food_collection',
  
  shouldActivate: (bot: Bot): boolean => {
    if (isWorkstationLocked()) return false;
    const foodPoints = getBotFoodPoints(bot);
    const trigger = getTriggerThreshold();
    const now = Date.now();

    if (foodPoints < trigger) {
      // Emergency override: if actual hunger bar is critically low, bypass cooldown.
      // At bot.food <= 6 the bot can't sprint and health regen is blocked, so waiting out
      // a cooldown means dying to any mob hit or starvation damage.
      const botHunger = (bot as any)?.food;
      const inEmergency = typeof botHunger === 'number' && botHunger <= EMERGENCY_HUNGER_THRESHOLD;

      // Check cooldown (skipped in emergency)
      if (!inEmergency && isFoodCollectionInCooldown()) {
        if (now - lastThrottledLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
          logger.debug(`FoodCollection: in cooldown`);
          lastThrottledLogTime = now;
        }
        return false;
      }

      if (inEmergency && isFoodCollectionInCooldown()) {
        // Clear cooldown so createState() doesn't also block.
        lastFailedAttempt = 0;
        if (now - lastThrottledLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
          logger.info(`FoodCollection: emergency bypass - bot.food=${botHunger} <= ${EMERGENCY_HUNGER_THRESHOLD}, clearing cooldown`);
          lastThrottledLogTime = now;
        }
      }

      if (now - lastThrottledLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
        logger.debug(`FoodCollection: should activate - foodPoints=${foodPoints} < trigger=${trigger}`);
        lastThrottledLogTime = now;
      }
      return true;
    }

    // Reset cooldown when we have enough food (food sources were found elsewhere)
    if (lastFailedAttempt > 0 && foodPoints >= trigger) {
      lastFailedAttempt = 0;
    }

    return false;
  },
  
  createState: async (bot: Bot) => {
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : null;
    
    const currentFoodPoints = getBotFoodPoints(bot);
    if (isFoodCollectionInCooldown()) {
      logger.debug(`FoodCollection: skipping start (in cooldown)`);
      return null;
    }
    foodCollectionActive = true;
    logger.info(`FoodCollection: starting - current food points = ${currentFoodPoints}`);
    
    if (sendChat) {
      sendChat(`low on food (${currentFoodPoints} points), collecting food`);
    }
    
    try {
      // Capture world snapshot for planning
      let worldSnapshot: any = null;
      try {
        const result = await captureAdaptiveSnapshot(bot as any, {
          radii: [32, 64, 96],
          onProgress: (msg: string) => logger.debug(`FoodCollection: ${msg}`)
        });
        worldSnapshot = result.snapshot;
      } catch (err: any) {
        logger.debug(`FoodCollection: snapshot capture failed - ${err?.message || err}`);
      }

      const startFoodPoints = currentFoodPoints;
      let outcome: { success: boolean; gainedFood: boolean; endFoodPoints: number } | null = null;

      // Diagnostic: snapshot bot state right before creating the GetFood state machine.
      // This is the point adjacent to where the 9/20 disconnect pattern manifests.
      try {
        const cl: any = (bot as any)?._client;
        const listenerCount = typeof (bot as any)?.listenerCount === 'function'
          ? (bot as any).listenerCount('physicsTick')
          : -1;
        const pathfinder: any = (bot as any)?.pathfinder;
        const pfIsMoving = typeof pathfinder?.isMoving === 'function' ? !!pathfinder.isMoving() : false;
        const pfIsMining = typeof pathfinder?.isMining === 'function' ? !!pathfinder.isMining() : false;
        logger.debug(
          `FoodCollection: pre-createState bot state food=${(bot as any)?.food} health=${(bot as any)?.health} ` +
          `clientState=${cl?.state} ended=${!!cl?.ended} sockWritable=${!!cl?.socket?.writable} ` +
          `serWritable=${!!cl?.serializer?.writable} physListeners=${listenerCount} ` +
          `pfMoving=${pfIsMoving} pfMining=${pfIsMining}`
        );
      } catch (_) {}

      let stateMachine: any;
      try {
        stateMachine = createGetFoodState(bot as any, {
          targetFoodPoints: foodCollectionConfig.targetFoodPoints,
          minFoodThreshold: getTriggerThreshold(),
          worldSnapshot
        });
      } catch (err: any) {
        logger.info(`FoodCollection: createGetFoodState threw - msg=${err?.message || err} stack=${err?.stack?.split('\n').slice(0, 6).join(' | ')}`);
        throw err;
      }

      const computeOutcome = () => {
        if (outcome) {
          return outcome;
        }
        const endFoodPoints = getBotFoodPoints(bot);
        const gainedFood = endFoodPoints > startFoodPoints;
        let success = gainedFood;
        if (typeof (stateMachine as any)?.wasSuccessful === 'function') {
          try {
            success = success || !!(stateMachine as any).wasSuccessful();
          } catch (_) {}
        }
        outcome = { success, gainedFood, endFoodPoints };
        return outcome;
      };

      const finalizeCompletion = () => {
        const { gainedFood, endFoodPoints } = computeOutcome();
        const belowTrigger = endFoodPoints < getTriggerThreshold();
        if (belowTrigger) {
          lastFailedAttempt = Date.now();
          if (gainedFood) {
            logger.info(`FoodCollection: still below trigger (${endFoodPoints} points), starting ${cooldownMs / 1000}s cooldown`);
            if (sendChat) {
              sendChat(`still low on food (${endFoodPoints} points), cooling down for ${cooldownMs / 1000}s`);
            }
            return;
          }
          logger.info(`FoodCollection: no food gained, starting ${cooldownMs / 1000}s cooldown`);
          if (sendChat) {
            sendChat(`no food sources found, cooling down for ${cooldownMs / 1000}s`);
          }
        } else {
          lastFailedAttempt = 0;
          if (sendChat) {
            sendChat(`food collection complete (${endFoodPoints} points)`);
          }
        }
      };

      return {
        stateMachine,
        isFinished: () => (typeof (stateMachine as any).isFinished === 'function' ? (stateMachine as any).isFinished() : false),
        wasSuccessful: () => computeOutcome().success,
        onStop: (reason: ReactiveBehaviorStopReason) => {
          foodCollectionActive = false;
          if (reason === 'completed') {
            finalizeCompletion();
          } else {
            logger.debug(`FoodCollection: stopped (${reason})`);
          }
        }
      };
    } catch (err: any) {
      foodCollectionActive = false;
      logger.info(`FoodCollection: failed to create state machine - ${err?.message || err}`);
      return null;
    }
  }
};
