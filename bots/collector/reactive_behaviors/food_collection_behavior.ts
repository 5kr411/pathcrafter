/**
 * Food collection reactive behavior
 * 
 * Monitors the bot's food inventory and triggers food acquisition
 * when supplies run low. Uses behaviorGetFood for the actual collection.
 */

import { ReactiveBehavior, Bot } from './types';
import { ReactiveBehaviorExecutor } from '../reactive_behavior_executor';
import { getInventoryObject } from '../../../utils/inventory';
import {
  calculateFoodPointsInInventory,
  DEFAULT_FOOD_CONFIG,
  FoodCollectionConfig
} from '../../../utils/foodConfig';
import { captureAdaptiveSnapshot } from '../../../utils/adaptiveSnapshot';
import createGetFoodState from '../../../behaviors/behaviorGetFood';
import logger from '../../../utils/logger';

const FOOD_COLLECTION_PRIORITY = 60;
const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute cooldown after failed collection

let foodCollectionConfig: FoodCollectionConfig = { ...DEFAULT_FOOD_CONFIG };
let lastFailedAttempt = 0;
let cooldownMs = DEFAULT_COOLDOWN_MS;

/**
 * Updates the food collection configuration
 */
export function setFoodCollectionConfig(config: Partial<FoodCollectionConfig>): void {
  foodCollectionConfig = { ...foodCollectionConfig, ...config };
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
 * Checks if currently in cooldown period
 */
function isInCooldown(): boolean {
  if (lastFailedAttempt === 0) return false;
  return Date.now() - lastFailedAttempt < cooldownMs;
}

/**
 * Gets remaining cooldown time in seconds
 */
function getCooldownRemaining(): number {
  if (!isInCooldown()) return 0;
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
    const threshold = foodCollectionConfig.minFoodThreshold;
    
    if (foodPoints < threshold) {
      // Check cooldown
      if (isInCooldown()) {
        const remaining = getCooldownRemaining();
        logger.debug(`FoodCollection: in cooldown (${remaining}s remaining)`);
        return false;
      }
      
      logger.debug(`FoodCollection: should activate - foodPoints=${foodPoints} < threshold=${threshold}`);
      return true;
    }
    
    // Reset cooldown when we have enough food (food sources were found elsewhere)
    if (lastFailedAttempt > 0 && foodPoints >= threshold) {
      lastFailedAttempt = 0;
    }
    
    return false;
  },
  
  execute: async (bot: Bot, executor: ReactiveBehaviorExecutor): Promise<any> => {
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : null;
    
    const currentFoodPoints = getBotFoodPoints(bot);
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
      
      let finished = false;
      const startFoodPoints = currentFoodPoints;
      
      const handleCompletion = (success: boolean) => {
        if (finished) return;
        finished = true;
        
        const newFoodPoints = getBotFoodPoints(bot);
        const gainedFood = newFoodPoints > startFoodPoints;
        
        // If we didn't gain any food, start cooldown to avoid infinite retries
        if (!gainedFood && newFoodPoints < foodCollectionConfig.minFoodThreshold) {
          lastFailedAttempt = Date.now();
          logger.info(`FoodCollection: no food gained, starting ${cooldownMs / 1000}s cooldown`);
          if (sendChat) {
            sendChat(`no food sources found, cooling down for ${cooldownMs / 1000}s`);
          }
        } else {
          // Successfully got food, reset cooldown
          lastFailedAttempt = 0;
          if (sendChat) {
            sendChat(`food collection complete (${newFoodPoints} points)`);
          }
        }
        
        executor.finish(success || gainedFood);
      };
      
      const stateMachine = createGetFoodState(bot as any, {
        targetFoodPoints: foodCollectionConfig.targetFoodPoints,
        minFoodThreshold: foodCollectionConfig.minFoodThreshold,
        worldSnapshot,
        onComplete: handleCompletion
      });
      
      // Set up completion check interval
      let completionInterval: NodeJS.Timeout | null = null;
      
      const clearCompletionInterval = () => {
        if (completionInterval) {
          clearInterval(completionInterval);
          completionInterval = null;
        }
      };
      
      const checkCompletion = () => {
        try {
          if (typeof (stateMachine as any).isFinished === 'function' && (stateMachine as any).isFinished()) {
            clearCompletionInterval();
            if (!finished) {
              const success = typeof (stateMachine as any).wasSuccessful === 'function' 
                ? (stateMachine as any).wasSuccessful() 
                : true;
              handleCompletion(success);
            }
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
        if (!finished) {
          handleCompletion(false);
        }
      };
      
      return stateMachine;
    } catch (err: any) {
      logger.info(`FoodCollection: failed to create state machine - ${err?.message || err}`);
      executor.finish(false);
      return null;
    }
  },
  
  onDeactivate: () => {
    logger.debug('FoodCollection: deactivated');
  }
};
