const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import createCraftNoTable from './behaviorCraftNoTable';
import { getItemCountInInventory } from '../utils/inventory';

import logger from '../utils/logger';

type Bot = any;

interface Targets {
  itemName: string;
  amount: number;
  [key: string]: any;
}

function createCraftNoTableIfNeededState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const craftNoTable = createCraftNoTable(bot, targets);
  const exit = new BehaviorIdle();

  const enterToExit = new StateTransition({
    name: 'BehaviorCraftNoTableIfNeeded: enter -> exit',
    parent: enter,
    child: exit,
    shouldTransition: () => {
      return getItemCountInInventory(bot, targets.itemName) >= targets.amount;
    },
    onTransition: () => {
      logger.info(
        `BehaviorCraftNoTableIfNeeded: enter -> exit: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`
      );
    }
  });

  const enterToCraftNoTable = new StateTransition({
    name: 'BehaviorCraftNoTableIfNeeded: enter -> craft no table',
    parent: enter,
    child: craftNoTable,
    shouldTransition: () => {
      return getItemCountInInventory(bot, targets.itemName) < targets.amount;
    },
    onTransition: () => {
      targets.amount = targets.amount - getItemCountInInventory(bot, targets.itemName);
      logger.info(
        `BehaviorCraftNoTableIfNeeded: enter -> craft no table: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`
      );
    }
  });

  const craftNoTableToExit = new StateTransition({
    name: 'BehaviorCraftNoTableIfNeeded: craft no table -> exit',
    parent: craftNoTable,
    child: exit,
    shouldTransition: () => craftNoTable.isFinished(),
    onTransition: () => {
      logger.info('BehaviorCraftNoTableIfNeeded: craft no table -> exit');
    }
  });

  const transitions = [enterToExit, enterToCraftNoTable, craftNoTableToExit];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createCraftNoTableIfNeededState;

