/**
 * Food smelting reactive behavior
 * 
 * Monitors the bot's inventory for raw food items and uses the planner
 * to smelt them into cooked food. The planner handles all dependencies
 * (furnace, fuel, tools) automatically.
 */

import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import { getInventoryObject, getItemCountInInventory } from '../../../utils/inventory';
import { FOOD_SMELT_MAPPINGS, calculateFoodPointsInInventory } from '../../../utils/foodConfig';
import { getFoodCollectionConfig, isFoodCollectionInCooldown } from './food_collection_behavior';
import { captureAdaptiveSnapshot } from '../../../utils/adaptiveSnapshot';
import { buildStateMachineForPath } from '../../../behavior_generator/buildMachine';
import { plan as planner, _internals as plannerInternals } from '../../../planner';
import logger from '../../../utils/logger';

const minecraftData = require('minecraft-data');

const FOOD_SMELTING_PRIORITY = 40;
const DEFAULT_COOLDOWN_MS = 60_000;
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000;
const DEFAULT_RADII = [32, 64, 96, 128];

let lastFailedAttempt = 0;
let cooldownMs = DEFAULT_COOLDOWN_MS;
let lastShouldActivateLogTime = 0;
let lastCooldownLogTime = 0;

/**
 * Sets the cooldown duration after failed smelting attempts
 */
export function setFoodSmeltingCooldown(ms: number): void {
  cooldownMs = ms;
}

/**
 * Resets the cooldown timer
 */
export function resetFoodSmeltingCooldown(): void {
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

interface RawFoodItem {
  rawName: string;
  cookedName: string;
  count: number;
}

/**
 * Finds raw food items in inventory that can be smelted
 */
function findRawFoodInInventory(bot: Bot): RawFoodItem[] {
  const inventory = getInventoryObject(bot as any);
  const rawFoodItems: RawFoodItem[] = [];
  
  for (const mapping of FOOD_SMELT_MAPPINGS) {
    const count = inventory[mapping.input] || 0;
    if (count > 0) {
      rawFoodItems.push({
        rawName: mapping.input,
        cookedName: mapping.output,
        count
      });
    }
  }
  
  return rawFoodItems;
}

/**
 * Plans for smelting raw food into cooked food
 */
async function tryPlanForCookedFood(
  bot: Bot,
  cookedItemName: string,
  targetCount: number,
  snapshot: any
): Promise<any[] | null> {
  try {
    const inventory = getInventoryObject(bot as any);
    const inventoryMap = new Map(Object.entries(inventory));
    const version = (bot as any).version || '1.20.1';
    const mcData = minecraftData(version);
    
    const tree = planner(mcData, cookedItemName, targetCount, {
      inventory: inventoryMap,
      log: false,
      pruneWithWorld: !!snapshot,
      combineSimilarNodes: true,
      worldSnapshot: snapshot
    });
    
    if (!tree) return null;
    
    const { enumerateActionPathsGenerator } = plannerInternals;
    const iter = enumerateActionPathsGenerator(tree, { inventory });
    
    for (const path of iter) {
      if (path && path.length > 0) {
        return path;
      }
    }
    
    return null;
  } catch (err: any) {
    logger.debug(`FoodSmelting: planning error - ${err?.message || err}`);
    return null;
  }
}

/**
 * Captures a world snapshot with validation for smelting paths
 */
async function captureSnapshotWithValidation(
  bot: Bot,
  cookedItemName: string,
  targetCount: number
): Promise<any> {
  const inventory = getInventoryObject(bot as any);
  const inventoryMap = new Map(Object.entries(inventory));
  const version = (bot as any).version || '1.20.1';
  const mcData = minecraftData(version);
  
  const validator = async (snapshot: any): Promise<boolean> => {
    try {
      const tree = planner(mcData, cookedItemName, targetCount, {
        inventory: new Map(inventoryMap),
        log: false,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: snapshot
      });
      
      if (!tree) {
        logger.debug(`FoodSmelting: validator - no tree at radius ${snapshot.radius}`);
        return false;
      }
      
      const { enumerateActionPathsGenerator } = plannerInternals;
      const iter = enumerateActionPathsGenerator(tree, { inventory });
      
      for (const path of iter) {
        if (path && path.length > 0) {
          logger.debug(`FoodSmelting: validator - found valid path at radius ${snapshot.radius}`);
          return true;
        }
      }
      
      logger.debug(`FoodSmelting: validator - no paths at radius ${snapshot.radius}`);
      return false;
    } catch (err: any) {
      logger.debug(`FoodSmelting: validator error - ${err?.message || err}`);
      return false;
    }
  };
  
  try {
    logger.info(`FoodSmelting: capturing adaptive snapshot with radii ${JSON.stringify(DEFAULT_RADII)}`);
    const result = await captureAdaptiveSnapshot(bot as any, {
      radii: DEFAULT_RADII,
      validator,
      onProgress: (msg: string) => logger.debug(`FoodSmelting: ${msg}`)
    });
    logger.info(`FoodSmelting: snapshot captured at radius ${result.radiusUsed} after ${result.attemptsCount} attempts`);
    return result.snapshot;
  } catch (err: any) {
    logger.info(`FoodSmelting: snapshot capture failed - ${err?.message || err}`);
    return null;
  }
}

export const foodSmeltingBehavior: ReactiveBehavior = {
  priority: FOOD_SMELTING_PRIORITY,
  name: 'food_smelting',
  
  shouldActivate: (bot: Bot): boolean => {
    const now = Date.now();
    
    // Don't smelt when food collection would actually run -- that is,
    // when food points are below the collection trigger AND collection
    // isn't in cooldown. Above the trigger, food collection won't
    // activate anyway so smelting is free to cook what we have.
    const inventory = getInventoryObject(bot as any);
    const foodPoints = calculateFoodPointsInInventory(inventory);
    const { triggerFoodPoints } = getFoodCollectionConfig();
    if (foodPoints < triggerFoodPoints && !isFoodCollectionInCooldown()) {
      return false;
    }
    
    // Check for raw food in inventory
    const rawFoodItems = findRawFoodInInventory(bot);
    
    if (rawFoodItems.length === 0) {
      return false;
    }
    
    // Check cooldown
    if (isInCooldown()) {
      if (now - lastCooldownLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
        const remaining = getCooldownRemaining();
        logger.debug(`FoodSmelting: in cooldown (${remaining}s remaining)`);
        lastCooldownLogTime = now;
      }
      return false;
    }
    
    if (now - lastShouldActivateLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
      const items = rawFoodItems.map(f => `${f.count}x ${f.rawName}`).join(', ');
      logger.debug(`FoodSmelting: should activate - raw food: ${items}`);
      lastShouldActivateLogTime = now;
    }
    
    return true;
  },
  
  createState: async (bot: Bot) => {
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : null;
    
    // Find raw food to smelt
    const rawFoodItems = findRawFoodInInventory(bot);
    
    if (rawFoodItems.length === 0) {
      logger.info('FoodSmelting: no raw food found');
      return null;
    }
    
    // Pick the first raw food item to smelt
    const targetFood = rawFoodItems[0];
    const { rawName, cookedName, count } = targetFood;
    
    logger.info(`FoodSmelting: starting - smelting ${count}x ${rawName} -> ${cookedName}`);
    
    if (sendChat) {
      sendChat(`smelting ${count}x ${rawName} into ${cookedName}`);
    }
    
    try {
      // Capture world snapshot for planning
      const snapshot = await captureSnapshotWithValidation(bot, cookedName, count);
      
      // Plan for cooked food
      const path = await tryPlanForCookedFood(bot, cookedName, count, snapshot);
      
      if (!path || path.length === 0) {
        logger.info('FoodSmelting: no viable path found');
        lastFailedAttempt = Date.now();
        if (sendChat) {
          sendChat(`cannot smelt ${rawName} - no viable path (missing resources?)`);
        }
        return null;
      }
      
      logger.info(`FoodSmelting: executing path with ${path.length} steps`);
      
      const startCookedCount = getItemCountInInventory(bot as any, cookedName);
      let outcome: { success: boolean; smelted: number } | null = null;
      let stateMachineFinished = false;
      
      const stateMachine = buildStateMachineForPath(
        bot,
        path,
        (_success: boolean) => {
          stateMachineFinished = true;
          const endCookedCount = getItemCountInInventory(bot as any, cookedName);
          const smelted = endCookedCount - startCookedCount;
          outcome = { success: smelted > 0, smelted };
          
          if (smelted > 0) {
            logger.info(`FoodSmelting: complete, smelted ${smelted}x ${cookedName}`);
            lastFailedAttempt = 0;
          } else {
            logger.info(`FoodSmelting: failed to smelt ${cookedName} (execution failed)`);
            lastFailedAttempt = Date.now();
          }
        }
      );
      
      const computeOutcome = () => {
        if (outcome) return outcome;
        const endCookedCount = getItemCountInInventory(bot as any, cookedName);
        const smelted = endCookedCount - startCookedCount;
        return { success: smelted > 0, smelted };
      };
      
      return {
        stateMachine,
        isFinished: () => stateMachineFinished || (typeof stateMachine.isFinished === 'function' && stateMachine.isFinished()),
        wasSuccessful: () => computeOutcome().success,
        onStop: (reason: ReactiveBehaviorStopReason) => {
          const { success, smelted } = computeOutcome();
          if (reason === 'completed') {
            if (success) {
              if (sendChat) {
                sendChat(`smelted ${smelted}x ${cookedName}`);
              }
            } else {
              if (sendChat) {
                sendChat(`smelting failed`);
              }
            }
          } else {
            logger.debug(`FoodSmelting: stopped (${reason})`);
          }
        }
      };
    } catch (err: any) {
      logger.info(`FoodSmelting: failed to create state machine - ${err?.message || err}`);
      lastFailedAttempt = Date.now();
      return null;
    }
  }
};
