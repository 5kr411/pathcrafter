/**
 * Opportunistic food hunt reactive behavior (factory form).
 *
 * When food is below target and a huntable animal is within 16 blocks,
 * quickly kills it and collects drops. No world snapshot, no planning.
 * Lightweight alternative to full food collection.
 *
 * Takes the food-collection handle as a dependency so cross-behavior reads
 * (trigger threshold, "active" flag) go through an explicit reference
 * instead of a module singleton.
 */

import {
  BehaviorIdle,
  NestedStateMachine,
  StateTransition
} from 'mineflayer-statemachine';
import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import { getInventoryObject } from '../../../utils/inventory';
import { calculateFoodPointsInInventory, HUNTABLE_LAND_ANIMALS } from '../../../utils/foodConfig';
import type { FoodCollectionHandle } from './food_collection_behavior';
import { isWorkstationLocked } from '../../../utils/workstationLock';
import { findClosestHuntableAnimal } from '../../../behaviors/huntForFoodHelpers';
import createHuntEntityState from '../../../behaviors/behaviorHuntEntity';
import logger from '../../../utils/logger';
import {
  BehaviorHuntWithTimeout,
  HUNT_TIMEOUT_MS
} from './opportunistic_food_hunt_states';

const OPPORTUNISTIC_HUNT_PRIORITY = 57;
const MAX_HUNT_DISTANCE = 16;
const FAILURE_COOLDOWN_MS = 60_000;
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000;

export interface OpportunisticFoodHuntOptions {
  foodCollection: FoodCollectionHandle;
}

export interface OpportunisticFoodHuntHandle {
  behavior: ReactiveBehavior;
  resetCooldown(): void;
  triggerCooldown(): void;
  isInCooldown(): boolean;
}

export function createOpportunisticFoodHuntBehavior(
  opts: OpportunisticFoodHuntOptions
): OpportunisticFoodHuntHandle {
  const { foodCollection } = opts;
  let lastFailedAttempt = 0;
  let lastThrottledLogTime = 0;

  function isInCooldown(): boolean {
    if (lastFailedAttempt === 0) return false;
    return Date.now() - lastFailedAttempt < FAILURE_COOLDOWN_MS;
  }

  const behavior: ReactiveBehavior = {
    priority: OPPORTUNISTIC_HUNT_PRIORITY,
    name: 'opportunistic_food_hunt',

    shouldActivate: (bot: Bot): boolean => {
      if (isWorkstationLocked()) return false;
      if (foodCollection.isActive()) return false;
      if (isInCooldown()) return false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
      const inventory = getInventoryObject(bot as any);
      const foodPoints = calculateFoodPointsInInventory(inventory);
      const { targetFoodPoints } = foodCollection.getConfig();

      if (foodPoints >= targetFoodPoints) return false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        ? (bot as any).safeChat.bind(bot)
        : null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
      const result = findClosestHuntableAnimal(bot as any, undefined, undefined, MAX_HUNT_DISTANCE);
      if (!result) return null;

      const { entity: targetAnimal, animalType } = result;
      logger.info(`OpportunisticFoodHunt: starting - hunting ${animalType}`);

      if (sendChat) {
        sendChat(`hunting nearby ${animalType} for food`);
      }

      const huntAnimalNames = new Set(HUNTABLE_LAND_ANIMALS.map(a => a.entity));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
      const targets: any = {
        entity: targetAnimal,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        entityFilter: (entity: any) => {
          if (!entity || !entity.name) return false;
          return huntAnimalNames.has(entity.name.toLowerCase());
        },
        detectionRange: MAX_HUNT_DISTANCE,
        attackRange: 3.5
      };

      const innerNSM = createHuntEntityState(bot, targets);
      const hunt = new BehaviorHuntWithTimeout(bot, innerNSM);
      const exit = new BehaviorIdle();

      const transitions = [
        new StateTransition({
          parent: hunt,
          child: exit,
          name: 'opportunistic-hunt: hunt -> exit (complete)',
          shouldTransition: () => hunt.innerFinished()
        }),
        new StateTransition({
          parent: hunt,
          child: exit,
          name: 'opportunistic-hunt: hunt -> exit (timeout)',
          shouldTransition: () => hunt.timedOut(),
          onTransition: () => {
            hunt.markTimedOut();
            logger.debug('OpportunisticFoodHunt: timeout reached');
          }
        })
      ];

      const stateMachine = new NestedStateMachine(transitions, hunt, exit);
      stateMachine.stateName = 'OpportunisticFoodHunt';

      return {
        stateMachine,
        isFinished: () => stateMachine.isFinished(),
        wasSuccessful: () => !hunt.didTimeout(),
        onStop: (reason: ReactiveBehaviorStopReason) => {
          if (reason === 'completed') {
            if (hunt.didTimeout()) {
              lastFailedAttempt = Date.now();
              if (sendChat) sendChat('hunt timed out');
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

  return {
    behavior,
    resetCooldown: () => { lastFailedAttempt = 0; },
    triggerCooldown: () => { lastFailedAttempt = Date.now(); },
    isInCooldown
  };
}

export { HUNT_TIMEOUT_MS };
