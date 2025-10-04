const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import { getItemCountInInventory } from '../utils/inventory';
import createAcquireCraftingTableState from './behaviorAcquireCraftingTable';
import createCollectBlockIfNeededState from './behaviorCollectBlockIfNeeded';
import createCraftWoodenToolsIfNeededState from './behaviorCraftWoodenToolsIfNeeded';

const createPlaceUtilityBlockState = require('./behaviorPlaceNear');
import logger from '../utils/logger';

type Bot = any;

interface Targets {
  blockName?: string;
  amount?: number;
  itemName?: string;
  [key: string]: any;
}

function createAcquireWoodenToolsState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const acquireCraftingTableState = createAcquireCraftingTableState(bot, targets as any);
  const collectLogsIfNeededState = createCollectBlockIfNeededState(bot, targets as any);
  const placeCraftingTableState = createPlaceUtilityBlockState(bot, targets);
  const craftWoodenToolsIfNeededState = createCraftWoodenToolsIfNeededState(bot, targets as any);
  const exit = new BehaviorIdle();

  const enterToExit = new StateTransition({
    name: 'BehaviorAcquireWoodenTools: enter -> exit',
    parent: enter,
    child: exit,
    shouldTransition: () =>
      getItemCountInInventory(bot, 'wooden_pickaxe') >= 1 && getItemCountInInventory(bot, 'wooden_axe') >= 1,
    onTransition: () => {
      logger.info('BehaviorAcquireWoodenTools: enter -> exit: Wooden tools in inventory');
    }
  });

  const enterToAcquireCraftingTable = new StateTransition({
    parent: enter,
    child: acquireCraftingTableState,
    name: 'BehaviorAcquireWoodenTools: enter -> acquire crafting table',
    shouldTransition: () => true,
    onTransition: () => {
      logger.info('BehaviorAcquireWoodenTools: enter -> acquire crafting table');
    }
  });

  function hasWoodenTool(bot: Bot): boolean {
    return getItemCountInInventory(bot, 'wooden_pickaxe') >= 1 || getItemCountInInventory(bot, 'wooden_axe') >= 1;
  }

  function needToCollectLogs(bot: Bot): boolean {
    if (getItemCountInInventory(bot, 'oak_log') >= 2) {
      logger.info('BehaviorAcquireWoodenTools: do not need to collect logs: already have 2 logs');
      return false;
    }

    if (getItemCountInInventory(bot, 'oak_planks') >= 8) {
      logger.info('BehaviorAcquireWoodenTools: do not need to collect logs: already have 8 planks');
      return false;
    }

    if (getItemCountInInventory(bot, 'oak_log') >= 1 && getItemCountInInventory(bot, 'oak_planks') >= 4) {
      logger.info('BehaviorAcquireWoodenTools: do not need to collect logs: already have 1 log and 4 planks');
      return false;
    }

    if (getItemCountInInventory(bot, 'oak_planks') >= 6 && getItemCountInInventory(bot, 'stick') >= 4) {
      logger.info('BehaviorAcquireWoodenTools: do not need to collect logs: already have 6 planks and 4 sticks');
      return false;
    }

    if (hasWoodenTool(bot) && getItemCountInInventory(bot, 'oak_planks') >= 5) {
      logger.info(
        'BehaviorAcquireWoodenTools: do not need to collect logs: already have a wooden tool and 5 planks'
      );
      return false;
    }

    if (
      hasWoodenTool(bot) &&
      getItemCountInInventory(bot, 'oak_planks') >= 3 &&
      getItemCountInInventory(bot, 'stick') >= 2
    ) {
      logger.info(
        'BehaviorAcquireWoodenTools: do not need to collect logs: already have a wooden tool and 3 planks and 2 sticks'
      );
      return false;
    }

    logger.info('BehaviorAcquireWoodenTools: need to collect logs');
    return true;
  }

  const acquireCraftingTableToCollectLogs = new StateTransition({
    parent: acquireCraftingTableState,
    child: collectLogsIfNeededState,
    name: 'BehaviorAcquireWoodenTools: acquire crafting table -> collect logs',
    shouldTransition: () => acquireCraftingTableState.isFinished() && needToCollectLogs(bot),
    onTransition: () => {
      logger.info('BehaviorAcquireWoodenTools: acquire crafting table -> collect logs');
      targets.blockName = 'oak_log';
      targets.amount = 2;
      targets.itemName = 'oak_log';
    }
  });

  let placeCraftingTableStartTime: number;
  const acquireCraftingTableToPlaceCraftingTable = new StateTransition({
    parent: acquireCraftingTableState,
    child: placeCraftingTableState,
    name: 'BehaviorAcquireWoodenTools: acquire crafting table -> place crafting table',
    shouldTransition: () => acquireCraftingTableState.isFinished() && !needToCollectLogs(bot),
    onTransition: () => {
      placeCraftingTableStartTime = Date.now();
      logger.info('BehaviorAcquireWoodenTools: acquire crafting table -> place crafting table');
    }
  });

  const collectLogsToPlaceCraftingTable = new StateTransition({
    parent: collectLogsIfNeededState,
    child: placeCraftingTableState,
    name: 'BehaviorAcquireWoodenTools: collect logs -> place crafting table',
    shouldTransition: () => collectLogsIfNeededState.isFinished(),
    onTransition: () => {
      placeCraftingTableStartTime = Date.now();
      logger.info('BehaviorAcquireWoodenTools: collect logs -> place crafting table');
    }
  });

  const placeCraftingTableToCraftWoodenTools = new StateTransition({
    parent: placeCraftingTableState,
    child: craftWoodenToolsIfNeededState,
    name: 'BehaviorAcquireWoodenTools: place crafting table -> craft wooden tools',
    shouldTransition: () => placeCraftingTableState.isFinished() && Date.now() - placeCraftingTableStartTime > 2000,
    onTransition: () => {
      logger.info('BehaviorAcquireWoodenTools: place crafting table -> craft wooden tools');
    }
  });

  const craftWoodenToolsToExit = new StateTransition({
    parent: craftWoodenToolsIfNeededState,
    child: exit,
    name: 'BehaviorAcquireWoodenTools: craft wooden tools -> exit',
    shouldTransition: () => craftWoodenToolsIfNeededState.isFinished(),
    onTransition: () => {
      logger.info('BehaviorAcquireWoodenTools: craft wooden tools -> exit');
    }
  });

  const transitions = [
    enterToExit,
    enterToAcquireCraftingTable,
    acquireCraftingTableToCollectLogs,
    acquireCraftingTableToPlaceCraftingTable,
    collectLogsToPlaceCraftingTable,
    placeCraftingTableToCraftWoodenTools,
    craftWoodenToolsToExit
  ];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createAcquireWoodenToolsState;

