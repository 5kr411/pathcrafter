/**
 * Food collection reactive behavior (factory form).
 *
 * Monitors the bot's food inventory and triggers food acquisition
 * when supplies run low. Uses behaviorGetFood for the actual collection.
 *
 * All state (config, cooldown timers, "active" flag, throttled log time)
 * lives in the closure of `createFoodCollectionBehavior` — one instance per
 * bot. The legacy module-level singletons are removed so two bots in the
 * same process never share state.
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

export interface FoodCollectionOptions {
  /** Initial config overrides. Merged over DEFAULT_FOOD_CONFIG. */
  config?: Partial<FoodCollectionConfig>;
  /** Initial cooldown duration in ms. Defaults to 20 minutes. */
  cooldownMs?: number;
}

export interface FoodCollectionHandle {
  behavior: ReactiveBehavior;
  setConfig(partial: Partial<FoodCollectionConfig>): void;
  getConfig(): FoodCollectionConfig;
  resetConfig(): void;
  setCooldown(ms: number): void;
  resetCooldown(): void;
  triggerCooldown(): void;
  isInCooldown(): boolean;
  isActive(): boolean;
}

export function createFoodCollectionBehavior(
  opts: FoodCollectionOptions = {}
): FoodCollectionHandle {
  let config: FoodCollectionConfig = { ...DEFAULT_FOOD_CONFIG, ...(opts.config ?? {}) };
  // Start in cooldown so the first run is delayed after join, matching the
  // previous module-level behavior.
  let lastFailedAttempt = Date.now();
  let cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  let lastThrottledLogTime = 0;
  let foodCollectionActive = false;

  function getTriggerThreshold(): number {
    const trigger = Number(config.triggerFoodPoints);
    if (Number.isFinite(trigger)) {
      return trigger;
    }
    return DEFAULT_FOOD_CONFIG.triggerFoodPoints;
  }

  function setConfig(partial: Partial<FoodCollectionConfig>): void {
    config = { ...config, ...partial };
    if (
      Number.isFinite(partial.minFoodThreshold) &&
      !Number.isFinite(partial.triggerFoodPoints as number)
    ) {
      config.triggerFoodPoints = Number(partial.minFoodThreshold);
    }
  }

  function getConfig(): FoodCollectionConfig {
    return { ...config };
  }

  function resetConfig(): void {
    config = { ...DEFAULT_FOOD_CONFIG };
  }

  function setCooldown(ms: number): void {
    cooldownMs = ms;
  }

  function resetCooldown(): void {
    lastFailedAttempt = 0;
  }

  function triggerCooldown(): void {
    lastFailedAttempt = Date.now();
  }

  function isInCooldown(): boolean {
    if (lastFailedAttempt === 0) return false;
    return Date.now() - lastFailedAttempt < cooldownMs;
  }

  function isActive(): boolean {
    return foodCollectionActive;
  }

  function getBotFoodPoints(bot: Bot): number {
    const inventory = getInventoryObject(bot as any);
    return calculateFoodPointsInInventory(inventory);
  }

  const behavior: ReactiveBehavior = {
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
        if (!inEmergency && isInCooldown()) {
          if (now - lastThrottledLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
            logger.debug(`FoodCollection: in cooldown`);
            lastThrottledLogTime = now;
          }
          return false;
        }

        if (inEmergency && isInCooldown()) {
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
      if (isInCooldown()) {
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
            targetFoodPoints: config.targetFoodPoints,
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

  return {
    behavior,
    setConfig,
    getConfig,
    resetConfig,
    setCooldown,
    resetCooldown,
    triggerCooldown,
    isInCooldown,
    isActive
  };
}
