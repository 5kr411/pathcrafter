const { StateTransition, BehaviorIdle, NestedStateMachine, BehaviorGetClosestEntity, BehaviorFollowEntity } = require('mineflayer-statemachine');
const minecraftData = require('minecraft-data');

import { getItemCountInInventory } from '../utils/inventory';
import createPlaceNearState from './behaviorPlaceNear';
import createBreakAtPositionState from './behaviorBreakAtPosition';
import logger from '../utils/logger';

type Bot = any;

interface Targets {
  itemName?: string;
  amount: number;
  [key: string]: any;
}

interface MinecraftData {
  itemsByName: Record<string, { id: number }>;
  items: Record<number, { name: string }>;
}

const createCraftWithTableState = (bot: Bot, targets: Targets): any => {
  const mcData: MinecraftData = minecraftData(bot.version);

  function getInventorySummary(): string {
    const items = bot.inventory?.items?.() || [];
    if (items.length === 0) return 'empty';
    return items.map((it: any) => `${it.name}:${it.count}`).join(', ');
  }

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
      .filter((item: any) => item.count < 0)
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
      const timesToCraft = Math.min(
        Math.ceil((targetCount - startingCount) / recipe.result.count),
        Math.floor(64 / recipe.result.count)
      );
      await bot.craft(recipe, timesToCraft, craftingTable);
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

  const placeTargets: { item: any; placedPosition?: any; placedConfirmed?: boolean } = {
    item: null,
    placedPosition: undefined,
    placedConfirmed: false
  };
  const placeTable = createPlaceNearState(bot, placeTargets);

  const waitForCraft = new BehaviorIdle();

  const breakTargets: { position: any } = { position: null };
  const breakTable = createBreakAtPositionState(bot, breakTargets);

  const waitForPickup = new BehaviorIdle();

  const dropTargets: { entity: any } = { entity: null };
  const findDrop = new BehaviorGetClosestEntity(bot, dropTargets, (e: any) =>
    e.name === 'item' && e.getDroppedItem && e.getDroppedItem()?.name === 'crafting_table'
  );
  const followDrop = new BehaviorFollowEntity(bot, dropTargets);

  let craftingDone = false;
  let tableCountBeforeBreak = 0;
  let waitStartTime = 0;

  const hasPickedUpTable = () => getItemCountInInventory(bot, 'crafting_table') > tableCountBeforeBreak;

  // enter -> exit (invalid targets)
  const enterToExit = new StateTransition({
    parent: enter,
    child: exit,
    name: 'CraftWithTable: enter -> exit (invalid)',
    shouldTransition: () => !targets.itemName || targets.amount == null,
    onTransition: () => logger.error('CraftWithTable: Missing itemName or amount')
  });

  // enter -> place
  const enterToPlace = new StateTransition({
    parent: enter,
    child: placeTable,
    name: 'CraftWithTable: enter -> place',
    shouldTransition: () => !!targets.itemName && targets.amount != null,
    onTransition: () => {
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
    onTransition: () => logger.error('CraftWithTable: Failed to place crafting table')
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
      logger.info('CraftWithTable: Table placed, starting craft');

      const craftingTable = placeTargets.placedPosition ? bot.blockAt(placeTargets.placedPosition, false) : null;
      if (!craftingTable) {
        logger.error('CraftWithTable: Could not find placed table');
        craftingDone = true;
        return;
      }

      craftItemWithTable(targets.itemName!, targets.amount, craftingTable)
        .then(() => { craftingDone = true; })
        .catch(() => { craftingDone = true; });
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
      logger.info(`CraftWithTable: Crafting done (${have}/${targets.amount}), breaking table (had ${tableCountBeforeBreak})`);
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
      logger.info('CraftWithTable: Table broken, waiting for auto-pickup');
    }
  });

  // wait -> exit (already picked up, after giving drop time to spawn)
  const waitToExitPickedUp = new StateTransition({
    parent: waitForPickup,
    child: exit,
    name: 'CraftWithTable: wait -> exit (picked up)',
    shouldTransition: () => hasPickedUpTable() && Date.now() - waitStartTime > 1000,
    onTransition: () => {
      const have = getItemCountInInventory(bot, targets.itemName!);
      logger.info(`CraftWithTable: Auto-picked up table, complete (${have}/${targets.amount} ${targets.itemName})`);
    }
  });

  // wait -> findDrop (not picked up after delay for drop to spawn)
  const waitToFindDrop = new StateTransition({
    parent: waitForPickup,
    child: findDrop,
    name: 'CraftWithTable: wait -> find drop',
    shouldTransition: () => !hasPickedUpTable() && Date.now() - waitStartTime > 1000,
    onTransition: () => {
      dropTargets.entity = null;
      logger.info('CraftWithTable: Not auto-picked up, looking for drop');
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

  // findDrop -> exit (timeout, no drop found)
  let findDropStartTime = 0;
  const findDropOnEnter = findDrop.onStateEntered?.bind(findDrop);
  findDrop.onStateEntered = () => {
    findDropStartTime = Date.now();
    if (findDropOnEnter) findDropOnEnter();
  };
  const findDropToExitTimeout = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'CraftWithTable: find drop -> exit (timeout)',
    shouldTransition: () => !dropTargets.entity && Date.now() - findDropStartTime > 3000,
    onTransition: () => {
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
    waitToFindDrop,
    findDropToExitPickedUp,
    findDropToFollow,
    findDropToExitTimeout,
    followDropToExitPickedUp,
    followDropToExitTimeout
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  stateMachine.onStateExited = function () {
    for (const sub of [placeTable, breakTable, followDrop]) {
      if (sub && typeof sub.onStateExited === 'function') {
        try { sub.onStateExited(); } catch (_) {}
      }
    }
    try { bot.clearControlStates(); } catch (_) {}
  };

  return stateMachine;
};

export default createCraftWithTableState;
