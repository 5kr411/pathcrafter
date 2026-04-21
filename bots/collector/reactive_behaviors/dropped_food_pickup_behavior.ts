/**
 * Dropped food pickup reactive behavior (factory form).
 *
 * Scans for dropped food item entities within 16 blocks and pathfinds
 * to collect them. Lightweight opportunistic behavior — no planning,
 * no world snapshots.
 *
 * Takes the food-collection handle as a dependency so cross-behavior reads
 * (target threshold, "active" flag) go through an explicit reference
 * instead of a module singleton.
 */

import {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  StateBehavior
} from 'mineflayer-statemachine';

import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import { getInventoryObject } from '../../../utils/inventory';
import { calculateFoodPointsInInventory, isFood } from '../../../utils/foodConfig';
import type { FoodCollectionHandle } from './food_collection_behavior';
import { isWorkstationLocked } from '../../../utils/workstationLock';
import { getDroppedItemInfo } from '../../../utils/droppedItems';
import logger from '../../../utils/logger';

const minecraftData = require('minecraft-data');

const DROPPED_FOOD_PICKUP_PRIORITY = 53;
const MAX_PICKUP_DISTANCE = 16;
const PICKUP_TIMEOUT_MS = 15_000;
const FAILURE_COOLDOWN_MS = 30_000;
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000;

export interface DroppedFoodPickupOptions {
  foodCollection: FoodCollectionHandle;
}

export interface DroppedFoodPickupHandle {
  behavior: ReactiveBehavior;
  resetCooldown(): void;
  triggerCooldown(): void;
  isInCooldown(): boolean;
}

interface DroppedFoodEntity {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  entity: any;
  foodName: string;
  count: number;
  distance: number;
}

function findDroppedFoodItems(bot: Bot): DroppedFoodEntity[] {
  if (!bot.entities || !bot.entity?.position) return [];

  const mcData = minecraftData(bot.version);
  const results: DroppedFoodEntity[] = [];

  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position) continue;
    if (entity.name !== 'item' && !(typeof entity.getDroppedItem === 'function' && entity.getDroppedItem())) continue;

    const distance = bot.entity.position.distanceTo!(entity.position);
    if (distance > MAX_PICKUP_DISTANCE) continue;

    const dropInfo = getDroppedItemInfo(entity, mcData);
    if (!dropInfo.name || dropInfo.count <= 0) continue;
    if (!isFood(dropInfo.name)) continue;

    results.push({
      entity,
      foodName: dropInfo.name,
      count: dropInfo.count,
      distance
    });
  }

  return results.sort((a, b) => a.distance - b.distance);
}

class BehaviorPickupDroppedFood implements StateBehavior {
  public stateName = 'PickupDroppedFood';
  public active = false;
  private finished = false;
  private success = false;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
    private readonly bot: any,
    private readonly droppedItems: DroppedFoodEntity[],
    private readonly sendChat: ((msg: string) => void) | null
  ) {}

  onStateEntered(): void {
    this.finished = false;
    this.success = false;
    this.active = true;
    this.executePickup();
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

  private async executePickup(): Promise<void> {
    const startTime = Date.now();
    let pickedUp = 0;

    try {
      for (const item of this.droppedItems) {
        if (Date.now() - startTime > PICKUP_TIMEOUT_MS) {
          logger.debug('DroppedFoodPickup: timeout reached');
          break;
        }

        // Check if entity still exists
        if (!this.bot.entities[item.entity.id]) continue;

        try {
          const { goals: { GoalNear } } = require('mineflayer-pathfinder');
          const goal = new GoalNear(
            item.entity.position.x,
            item.entity.position.y,
            item.entity.position.z,
            1
          );
          await this.bot.pathfinder.goto(goal);

          // Wait briefly for auto-pickup
          await new Promise(r => setTimeout(r, 500));

          // Check if entity despawned (= picked up)
          if (!this.bot.entities[item.entity.id]) {
            pickedUp++;
            logger.debug(`DroppedFoodPickup: picked up ${item.foodName} x${item.count}`);
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
        } catch (err: any) {
          logger.debug(`DroppedFoodPickup: failed to reach ${item.foodName} - ${err?.message || err}`);
        }
      }

      this.success = pickedUp > 0;
      if (pickedUp > 0 && this.sendChat) {
        this.sendChat(`picked up ${pickedUp} dropped food item${pickedUp > 1 ? 's' : ''}`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`DroppedFoodPickup: error - ${err?.message || err}`);
      this.success = false;
    } finally {
      this.finished = true;
    }
  }
}

export function createDroppedFoodPickupBehavior(
  opts: DroppedFoodPickupOptions
): DroppedFoodPickupHandle {
  const { foodCollection } = opts;
  let lastFailedAttempt = 0;
  let lastThrottledLogTime = 0;

  function isInCooldown(): boolean {
    if (lastFailedAttempt === 0) return false;
    return Date.now() - lastFailedAttempt < FAILURE_COOLDOWN_MS;
  }

  const behavior: ReactiveBehavior = {
    priority: DROPPED_FOOD_PICKUP_PRIORITY,
    name: 'dropped_food_pickup',

    shouldActivate: (bot: Bot): boolean => {
      if (isWorkstationLocked()) return false;
      if (foodCollection.isActive()) return false;
      if (isInCooldown()) return false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
      const inventory = getInventoryObject(bot as any);
      const foodPoints = calculateFoodPointsInInventory(inventory);
      const { targetFoodPoints } = foodCollection.getConfig();

      if (foodPoints >= targetFoodPoints) return false;

      const droppedFood = findDroppedFoodItems(bot);
      if (droppedFood.length === 0) return false;

      const now = Date.now();
      if (now - lastThrottledLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
        const items = droppedFood.map(d => `${d.count}x ${d.foodName}`).join(', ');
        logger.debug(`DroppedFoodPickup: should activate - found ${items}`);
        lastThrottledLogTime = now;
      }

      return true;
    },

    createState: async (bot: Bot) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        ? (bot as any).safeChat.bind(bot)
        : null;

      const droppedFood = findDroppedFoodItems(bot);
      if (droppedFood.length === 0) {
        return null;
      }

      logger.info(`DroppedFoodPickup: starting - ${droppedFood.length} food item(s) nearby`);

      const enter = new BehaviorIdle();
      const exit = new BehaviorIdle();
      const pickupState = new BehaviorPickupDroppedFood(bot, droppedFood, sendChat);
      let reachedExit = false;

      const enterToPickup = new StateTransition({
        parent: enter,
        child: pickupState,
        name: 'dropped-food-pickup: enter -> pickup',
        shouldTransition: () => true
      });

      const pickupToExit = new StateTransition({
        parent: pickupState,
        child: exit,
        name: 'dropped-food-pickup: pickup -> exit',
        shouldTransition: () => pickupState.isFinished(),
        onTransition: () => { reachedExit = true; }
      });

      const stateMachine = new NestedStateMachine([enterToPickup, pickupToExit], enter, exit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
      (stateMachine as any).isFinished = () => reachedExit;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
      (stateMachine as any).wasSuccessful = () => pickupState.wasSuccessful();

      return {
        stateMachine,
        isFinished: () => reachedExit,
        wasSuccessful: () => pickupState.wasSuccessful(),
        onStop: (reason: ReactiveBehaviorStopReason) => {
          if (reason === 'completed' && !pickupState.wasSuccessful()) {
            lastFailedAttempt = Date.now();
          }
          if (reason !== 'completed') {
            logger.debug(`DroppedFoodPickup: stopped (${reason})`);
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
