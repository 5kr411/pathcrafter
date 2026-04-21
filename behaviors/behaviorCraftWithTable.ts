const { StateTransition, BehaviorIdle, NestedStateMachine, BehaviorGetClosestEntity } = require('mineflayer-statemachine');
const minecraftData = require('minecraft-data');

import { getItemCountInInventory } from '../utils/inventory';
import { ensureInventoryRoom } from '../utils/inventoryGate';
import createPlaceNearState from './behaviorPlaceNear';
import createBreakAtPositionState from './behaviorBreakAtPosition';
import logger from '../utils/logger';
import { BehaviorSafeFollowEntity } from './behaviorSafeFollowEntity';
import { BehaviorSmartMoveTo } from './behaviorSmartMoveTo';
import { BehaviorWander } from './behaviorWander';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
type Bot = any;

interface Targets {
  itemName?: string;
  amount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface MinecraftData {
  itemsByName: Record<string, { id: number }>;
  items: Record<number, { name: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
const createCraftWithTableState = (bot: Bot, targets: Targets): any => {
  const mcData: MinecraftData = minecraftData(bot.version);

  function getInventorySummary(): string {
    const items = bot.inventory?.items?.() || [];
    if (items.length === 0) return 'empty';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    return items.map((it: any) => `${it.name}:${it.count}`).join(', ');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const craftItemWithTable = async (itemName: string, additionalNeeded: number, craftingTable: any): Promise<boolean> => {
    const item = mcData.itemsByName[itemName];
    if (!item) {
      logger.error(`CraftWithTable: Item ${itemName} not found`);
      return false;
    }

    logger.info(`CraftWithTable: Crafting ${itemName}, inventory: { ${getInventorySummary()} }`);
    const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
    if (!recipes.length) {
      logger.error(`CraftWithTable: No recipe found for ${itemName}`);
      return false;
    }

    const recipe = recipes[0];
    const startingCount = getItemCountInInventory(bot, itemName);
    const targetCount = startingCount + additionalNeeded;

    const hasIngredients = recipe.delta
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      .filter((item: any) => item.count < 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      .every((item: any) => {
        const requiredCount = Math.abs(item.count);
        const availableCount = getItemCountInInventory(bot, mcData.items[item.id].name);
        return availableCount >= requiredCount;
      });

    if (!hasIngredients) {
      logger.error(`CraftWithTable: Missing ingredients for ${itemName}`);
      return false;
    }

    try {
      await ensureInventoryRoom(bot);
      const timesToCraft = Math.min(
        Math.ceil((targetCount - startingCount) / recipe.result.count),
        Math.floor(64 / recipe.result.count)
      );
      await bot.craft(recipe, timesToCraft, craftingTable);
      // Wait a tick for server inventory sync to avoid desync from rapid crafting
      await new Promise(r => setTimeout(r, 50));
      const newCount = getItemCountInInventory(bot, itemName);
      logger.info(`CraftWithTable: Crafted ${itemName}, now have ${newCount}/${targetCount}`);
      return newCount >= targetCount;
    } catch (err) {
      logger.error(`CraftWithTable: Error crafting ${itemName}:`, err);
      return false;
    }
  };

  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const placeTargets: { item: any; placedPosition?: any; placedConfirmed?: boolean } = {
    item: null,
    placedPosition: undefined,
    placedConfirmed: false
  };
  const placeTable = createPlaceNearState(bot, placeTargets);

  const waitForCraft = new BehaviorIdle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const breakTargets: { position: any } = { position: null };
  const breakTable = createBreakAtPositionState(bot, breakTargets);

  const waitForPickup = new BehaviorIdle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const dropTargets: { entity: any } = { entity: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const findDrop = new BehaviorGetClosestEntity(bot, dropTargets, (e: any) =>
    e.name === 'item' && e.getDroppedItem && e.getDroppedItem()?.name === 'crafting_table'
  );
  const followDrop = new BehaviorSafeFollowEntity(bot, dropTargets);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const walkBackTargets: { position: any } = { position: null };
  const walkBack = new BehaviorSmartMoveTo(bot, walkBackTargets);
  walkBack.distance = 1;
  const microWander = new BehaviorWander(bot, 4);

  let craftingDone = false;
  let craftingOk = false;
  let tableCountBeforeBreak = 0;
  let waitStartTime = 0;
  let pickupAttempts = 0;

  const hasPickedUpTable = () => getItemCountInInventory(bot, 'crafting_table') > tableCountBeforeBreak;

  // enter -> exit (invalid targets)
  const enterToExit = new StateTransition({
    parent: enter,
    child: exit,
    name: 'CraftWithTable: enter -> exit (invalid)',
    shouldTransition: () => !targets.itemName || targets.amount == null,
    onTransition: () => {
      stateMachine.stepSucceeded = false;
      stateMachine.stepFailureReason = 'missing_item_or_amount';
      logger.error('CraftWithTable: Missing itemName or amount');
    }
  });

  // enter -> place
  const enterToPlace = new StateTransition({
    parent: enter,
    child: placeTable,
    name: 'CraftWithTable: enter -> place',
    shouldTransition: () => !!targets.itemName && targets.amount != null,
    onTransition: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      placeTargets.item = bot.inventory.items().find((i: any) => i?.name === 'crafting_table') || null;
      placeTargets.placedPosition = undefined;
      placeTargets.placedConfirmed = false;
      logger.info(`CraftWithTable: Placing table to craft ${targets.amount} ${targets.itemName}`);
    }
  });

  // place -> exit (failed)
  const placeToExitFailed = new StateTransition({
    parent: placeTable,
    child: exit,
    name: 'CraftWithTable: place -> exit (failed)',
    shouldTransition: () => {
      if (typeof placeTable.isFinished !== 'function') return false;
      return placeTable.isFinished() && !placeTargets.placedConfirmed;
    },
    onTransition: () => {
      stateMachine.stepSucceeded = false;
      stateMachine.stepFailureReason = `place_table_failed:${targets.itemName}`;
      logger.error('CraftWithTable: Failed to place crafting table');
    }
  });

  // place -> craft
  const placeToCraft = new StateTransition({
    parent: placeTable,
    child: waitForCraft,
    name: 'CraftWithTable: place -> craft',
    shouldTransition: () => {
      if (typeof placeTable.isFinished !== 'function') return false;
      return placeTable.isFinished() && !!placeTargets.placedConfirmed;
    },
    onTransition: () => {
      craftingDone = false;
      craftingOk = false;
      logger.info('CraftWithTable: Table placed, starting craft');

      const craftingTable = placeTargets.placedPosition ? bot.blockAt(placeTargets.placedPosition, false) : null;
      if (!craftingTable) {
        logger.error('CraftWithTable: Could not find placed table');
        craftingDone = true;
        return;
      }

      craftItemWithTable(targets.itemName!, targets.amount, craftingTable)
        .then((ok) => { craftingOk = !!ok; craftingDone = true; })
        .catch(() => { craftingOk = false; craftingDone = true; });
    }
  });

  // craft -> break
  const craftToBreak = new StateTransition({
    parent: waitForCraft,
    child: breakTable,
    name: 'CraftWithTable: craft -> break',
    shouldTransition: () => craftingDone,
    onTransition: () => {
      tableCountBeforeBreak = getItemCountInInventory(bot, 'crafting_table');
      breakTargets.position = placeTargets.placedPosition;
      const have = getItemCountInInventory(bot, targets.itemName!);
      if (have < targets.amount! && !craftingOk) {
        stateMachine.stepSucceeded = false;
        stateMachine.stepFailureReason = `craft_failed:${targets.itemName}:${have}/${targets.amount}`;
        logger.info(`CraftWithTable: Crafting failed (${have}/${targets.amount}), breaking table (had ${tableCountBeforeBreak})`);
      } else {
        if (!craftingOk) {
          logger.warn(`CraftWithTable: Crafting done (${have}/${targets.amount}, craft promise failed but inventory satisfied), breaking table (had ${tableCountBeforeBreak})`);
        } else {
          logger.info(`CraftWithTable: Crafting done (${have}/${targets.amount}), breaking table (had ${tableCountBeforeBreak})`);
        }
      }
    }
  });

  // break -> wait for auto-pickup
  const breakToWait = new StateTransition({
    parent: breakTable,
    child: waitForPickup,
    name: 'CraftWithTable: break -> wait',
    shouldTransition: () => breakTable.isFinished(),
    onTransition: () => {
      waitStartTime = Date.now();
      pickupAttempts = 0;
      logger.info('CraftWithTable: Table broken, waiting for auto-pickup');
    }
  });

  // wait -> exit (already picked up, after giving drop time to spawn)
  const waitToExitPickedUp = new StateTransition({
    parent: waitForPickup,
    child: exit,
    name: 'CraftWithTable: wait -> exit (picked up)',
    shouldTransition: () => hasPickedUpTable() && Date.now() - waitStartTime > 2500,
    onTransition: () => {
      const have = getItemCountInInventory(bot, targets.itemName!);
      logger.info(`CraftWithTable: Auto-picked up table, complete (${have}/${targets.amount} ${targets.itemName})`);
    }
  });

  // wait -> walkBack (not picked up after delay)
  const waitToWalkBack = new StateTransition({
    parent: waitForPickup,
    child: walkBack,
    name: 'CraftWithTable: wait -> walk back',
    shouldTransition: () => !hasPickedUpTable() && Date.now() - waitStartTime > 2500,
    onTransition: () => {
      walkBackTargets.position = placeTargets.placedPosition;
      logger.info('CraftWithTable: Not auto-picked up, walking back to break position');
    }
  });

  // walkBack -> findDrop (arrived)
  const walkBackToFindDrop = new StateTransition({
    parent: walkBack,
    child: findDrop,
    name: 'CraftWithTable: walk back -> find drop',
    shouldTransition: () => walkBack.isFinished(),
    onTransition: () => {
      dropTargets.entity = null;
      logger.info('CraftWithTable: Arrived at break position, looking for drop');
    }
  });

  // walkBack -> findDrop (timeout safety)
  let walkBackStartTime = 0;
  const walkBackOnEnter = walkBack.onStateEntered?.bind(walkBack);
  walkBack.onStateEntered = () => {
    walkBackStartTime = Date.now();
    if (walkBackOnEnter) walkBackOnEnter();
  };
  const walkBackTimeout = new StateTransition({
    parent: walkBack,
    child: findDrop,
    name: 'CraftWithTable: walk back -> find drop (timeout)',
    shouldTransition: () => Date.now() - walkBackStartTime > 3000,
    onTransition: () => {
      dropTargets.entity = null;
      logger.info('CraftWithTable: Walk back timed out, looking for drop');
    }
  });

  // findDrop -> exit (picked up)
  const findDropToExitPickedUp = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'CraftWithTable: find drop -> exit (picked up)',
    shouldTransition: () => hasPickedUpTable(),
    onTransition: () => {
      const have = getItemCountInInventory(bot, targets.itemName!);
      logger.info(`CraftWithTable: Picked up table, complete (${have}/${targets.amount} ${targets.itemName})`);
    }
  });

  // findDrop -> followDrop
  const findDropToFollow = new StateTransition({
    parent: findDrop,
    child: followDrop,
    name: 'CraftWithTable: find drop -> follow',
    shouldTransition: () => !!dropTargets.entity,
    onTransition: () => {
      const pos = dropTargets.entity?.position;
      logger.info(`CraftWithTable: Found drop at (${pos?.x?.toFixed(1)}, ${pos?.y?.toFixed(1)}, ${pos?.z?.toFixed(1)})`);
    }
  });

  // findDrop timeout handling with retry via microWander
  let findDropStartTime = 0;
  const findDropOnEnter = findDrop.onStateEntered?.bind(findDrop);
  findDrop.onStateEntered = () => {
    findDropStartTime = Date.now();
    if (findDropOnEnter) findDropOnEnter();
  };

  // findDrop -> microWander (timeout, attempt < 2)
  const findDropToMicroWander = new StateTransition({
    parent: findDrop,
    child: microWander,
    name: 'CraftWithTable: find drop -> micro wander (retry)',
    shouldTransition: () => !dropTargets.entity && Date.now() - findDropStartTime > 6000 && pickupAttempts < 2,
    onTransition: () => {
      pickupAttempts++;
      logger.info(`CraftWithTable: Drop not found, micro-wandering (attempt ${pickupAttempts})`);
    }
  });

  // microWander -> findDrop (wander finished)
  const microWanderToFindDrop = new StateTransition({
    parent: microWander,
    child: findDrop,
    name: 'CraftWithTable: micro wander -> find drop',
    shouldTransition: () => microWander.isFinished,
    onTransition: () => {
      dropTargets.entity = null;
      findDropStartTime = Date.now();
      logger.info('CraftWithTable: Wander done, looking for drop again');
    }
  });

  // findDrop -> exit (timeout, attempts exhausted)
  const findDropToExitTimeout = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'CraftWithTable: find drop -> exit (timeout)',
    shouldTransition: () => !dropTargets.entity && Date.now() - findDropStartTime > 6000 && pickupAttempts >= 2,
    onTransition: () => {
      stateMachine.stepSucceeded = false;
      stateMachine.stepFailureReason = `dropped_table_lost:${targets.itemName}`;
      const have = getItemCountInInventory(bot, targets.itemName!);
      logger.warn(`CraftWithTable: Could not find dropped table, exiting (${have}/${targets.amount} ${targets.itemName})`);
    }
  });

  // followDrop -> exit (picked up)
  const followDropToExitPickedUp = new StateTransition({
    parent: followDrop,
    child: exit,
    name: 'CraftWithTable: follow drop -> exit (picked up)',
    shouldTransition: () => hasPickedUpTable(),
    onTransition: () => {
      const have = getItemCountInInventory(bot, targets.itemName!);
      logger.info(`CraftWithTable: Collected table, complete (${have}/${targets.amount} ${targets.itemName})`);
    }
  });

  // followDrop -> exit (timeout)
  let followStartTime = 0;
  const followOnEnter = followDrop.onStateEntered?.bind(followDrop);
  followDrop.onStateEntered = () => {
    followStartTime = Date.now();
    if (followOnEnter) followOnEnter();
  };
  const followDropToExitTimeout = new StateTransition({
    parent: followDrop,
    child: exit,
    name: 'CraftWithTable: follow drop -> exit (timeout)',
    shouldTransition: () => Date.now() - followStartTime > 5000,
    onTransition: () => {
      stateMachine.stepSucceeded = false;
      stateMachine.stepFailureReason = `follow_timeout:${targets.itemName}`;
      const have = getItemCountInInventory(bot, targets.itemName!);
      logger.warn(`CraftWithTable: Follow timeout, exiting (${have}/${targets.amount} ${targets.itemName})`);
    }
  });

  const transitions = [
    enterToExit,
    enterToPlace,
    placeToExitFailed,
    placeToCraft,
    craftToBreak,
    breakToWait,
    waitToExitPickedUp,
    waitToWalkBack,
    walkBackToFindDrop,
    walkBackTimeout,
    findDropToExitPickedUp,
    findDropToFollow,
    findDropToMicroWander,
    findDropToExitTimeout,
    microWanderToFindDrop,
    followDropToExitPickedUp,
    followDropToExitTimeout
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  stateMachine.onStateExited = function () {
    for (const sub of [placeTable, breakTable, followDrop, walkBack, microWander]) {
      if (sub && typeof sub.onStateExited === 'function') {
        try { sub.onStateExited(); } catch (_) {}
      }
    }
    try { bot.clearControlStates(); } catch (_) {}
  };

  return stateMachine;
};

export default createCraftWithTableState;
