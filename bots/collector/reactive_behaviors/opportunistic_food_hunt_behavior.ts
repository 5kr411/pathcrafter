/**
 * Opportunistic food hunt reactive behavior
 *
 * When food is below target and a huntable animal is within 16 blocks,
 * quickly kills it and collects drops. No world snapshot, no planning.
 * Lightweight alternative to full food collection.
 */

import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import { getInventoryObject } from '../../../utils/inventory';
import { calculateFoodPointsInInventory, HUNTABLE_LAND_ANIMALS } from '../../../utils/foodConfig';
import { getFoodCollectionConfig, isFoodCollectionActive } from './food_collection_behavior';
import { isWorkstationLocked } from '../../../utils/workstationLock';
import { findClosestHuntableAnimal } from '../../../behaviors/huntForFoodHelpers';
import createHuntEntityState from '../../../behaviors/behaviorHuntEntity';
import logger from '../../../utils/logger';

const OPPORTUNISTIC_HUNT_PRIORITY = 57;
const MAX_HUNT_DISTANCE = 16;
const HUNT_TIMEOUT_MS = 60_000;
const FAILURE_COOLDOWN_MS = 60_000;
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000;

let lastFailedAttempt = 0;
let lastThrottledLogTime = 0;

function isInCooldown(): boolean {
  if (lastFailedAttempt === 0) return false;
  return Date.now() - lastFailedAttempt < FAILURE_COOLDOWN_MS;
}

export const opportunisticFoodHuntBehavior: ReactiveBehavior = {
  priority: OPPORTUNISTIC_HUNT_PRIORITY,
  name: 'opportunistic_food_hunt',

  shouldActivate: (bot: Bot): boolean => {
    if (isWorkstationLocked()) return false;
    if (isFoodCollectionActive()) return false;
    if (isInCooldown()) return false;

    const inventory = getInventoryObject(bot as any);
    const foodPoints = calculateFoodPointsInInventory(inventory);
    const { targetFoodPoints } = getFoodCollectionConfig();

    if (foodPoints >= targetFoodPoints) return false;

    const result = findClosestHuntableAnimal(bot as any, undefined, undefined, MAX_HUNT_DISTANCE);
    if (!result) return false;

    const now = Date.now();
    if (now - lastThrottledLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
      logger.debug(`OpportunisticFoodHunt: should activate - ${result.animalType} nearby, foodPoints=${foodPoints}`);
      lastThrottledLogTime = now;
    }

    return true;
  },

  createState: (bot: Bot) => {
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : null;

    const result = findClosestHuntableAnimal(bot as any, undefined, undefined, MAX_HUNT_DISTANCE);
    if (!result) return null;

    const { entity: targetAnimal, animalType } = result;
    logger.info(`OpportunisticFoodHunt: starting - hunting ${animalType}`);

    if (sendChat) {
      sendChat(`hunting nearby ${animalType} for food`);
    }

    const huntAnimalNames = new Set(HUNTABLE_LAND_ANIMALS.map(a => a.entity));
    let huntFinished = false;
    let huntTimeoutId: NodeJS.Timeout | null = null;

    const targets: any = {
      entity: targetAnimal,
      entityFilter: (entity: any) => {
        if (!entity || !entity.name) return false;
        return huntAnimalNames.has(entity.name.toLowerCase());
      },
      detectionRange: MAX_HUNT_DISTANCE,
      attackRange: 3.5
    };

    const stateMachine = createHuntEntityState(bot, targets);

    // Set timeout
    huntTimeoutId = setTimeout(() => {
      huntFinished = true;
      logger.debug('OpportunisticFoodHunt: timeout reached');
    }, HUNT_TIMEOUT_MS);

    const cleanup = () => {
      if (huntTimeoutId) {
        clearTimeout(huntTimeoutId);
        huntTimeoutId = null;
      }
    };

    return {
      stateMachine,
      isFinished: () => {
        if (huntFinished) return true;
        return typeof stateMachine.isFinished === 'function' ? stateMachine.isFinished() : false;
      },
      wasSuccessful: () => !huntFinished, // timed out = failure
      onStop: (reason: ReactiveBehaviorStopReason) => {
        cleanup();
        if (reason === 'completed') {
          if (huntFinished) {
            // Timed out
            lastFailedAttempt = Date.now();
            if (sendChat) sendChat(`hunt timed out`);
          } else {
            if (sendChat) sendChat(`done hunting ${animalType}`);
          }
        } else {
          logger.debug(`OpportunisticFoodHunt: stopped (${reason})`);
        }
      }
    };
  }
};
