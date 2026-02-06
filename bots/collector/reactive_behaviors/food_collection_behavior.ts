/**
 * Food collection reactive behavior
 * 
 * Monitors the bot's food inventory and triggers food acquisition
 * when supplies run low. Uses behaviorGetFood for the actual collection.
 */

import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
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
const DEFAULT_COOLDOWN_MS = 120_000; // 2 minute cooldown after failed collection
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000; // Only log "should activate" every 10s

let foodCollectionConfig: FoodCollectionConfig = { ...DEFAULT_FOOD_CONFIG };
let lastFailedAttempt = 0;
let cooldownMs = DEFAULT_COOLDOWN_MS;
let lastShouldActivateLogTime = 0;
let lastCooldownLogTime = 0;
let wasPreempted = false;

function getTriggerThreshold(): number {
  const trigger = Number(foodCollectionConfig.triggerFoodPoints);
  if (Number.isFinite(trigger)) {
    return trigger;
  }
  const legacy = Number(foodCollectionConfig.minFoodThreshold);
  if (Number.isFinite(legacy)) {
    return legacy;
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
  wasPreempted = false;
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
 * Gets remaining cooldown time in seconds
 */
function getCooldownRemaining(): number {
  if (!isFoodCollectionInCooldown()) return 0;
  return Math.ceil((cooldownMs - (Date.now() - lastFailedAttempt)) / 1000);
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
    const foodPoints = getBotFoodPoints(bot);
    const trigger = getTriggerThreshold();
    const now = Date.now();
    
    // After being preempted (e.g. by eating), use the target threshold so
    // we resume collecting until the goal is actually reached.
    const threshold = wasPreempted
      ? foodCollectionConfig.targetFoodPoints
      : trigger;
    
    if (foodPoints < threshold) {
      // Check cooldown
      if (isFoodCollectionInCooldown()) {
        if (now - lastCooldownLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
          const remaining = getCooldownRemaining();
          logger.debug(`FoodCollection: in cooldown (${remaining}s remaining)`);
          lastCooldownLogTime = now;
        }
        return false;
      }
      
      if (now - lastShouldActivateLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
        logger.debug(`FoodCollection: should activate - foodPoints=${foodPoints} < threshold=${threshold}${wasPreempted ? ' (resuming after preemption)' : ''}`);
        lastShouldActivateLogTime = now;
      }
      return true;
    }
    
    // Target reached, clear preemption flag
    if (wasPreempted && foodPoints >= foodCollectionConfig.targetFoodPoints) {
      wasPreempted = false;
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
      const remaining = getCooldownRemaining();
      logger.debug(`FoodCollection: skipping start (cooldown ${remaining}s remaining)`);
      return null;
    }
    wasPreempted = false;
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

      const stateMachine = createGetFoodState(bot as any, {
        targetFoodPoints: foodCollectionConfig.targetFoodPoints,
        minFoodThreshold: getTriggerThreshold(),
        worldSnapshot
      });

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
          if (reason === 'completed') {
            wasPreempted = false;
            finalizeCompletion();
          } else if (reason === 'preempted') {
            wasPreempted = true;
            logger.debug(`FoodCollection: stopped (${reason}), will resume until target reached`);
          } else {
            wasPreempted = false;
            logger.debug(`FoodCollection: stopped (${reason})`);
          }
        }
      };
    } catch (err: any) {
      logger.info(`FoodCollection: failed to create state machine - ${err?.message || err}`);
      return null;
    }
  }
};
