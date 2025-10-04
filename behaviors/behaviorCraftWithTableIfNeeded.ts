const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import createCraftWithTable from './behaviorCraftWithTable';
import { getItemCountInInventory } from '../utils/inventory';

import logger from '../utils/logger';

type Bot = any;

interface Targets {
  itemName: string;
  amount: number;
  [key: string]: any;
}

function createCraftWithTableIfNeeded(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const craftWithTableState = createCraftWithTable(bot, targets);
  const exit = new BehaviorIdle();

  const enterToExit = new StateTransition({
    name: 'BehaviorCraftWithTableIfNeeded: enter -> exit',
    parent: enter,
    child: exit,
    shouldTransition: () => {
      return getItemCountInInventory(bot, targets.itemName) >= targets.amount;
    },
    onTransition: () => {
      logger.info(
        `BehaviorCraftWithTableIfNeeded: enter -> exit: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`
      );
    }
  });

  const enterToCraftWithTable = new StateTransition({
    parent: enter,
    child: craftWithTableState,
    name: 'BehaviorCraftWithTableIfNeeded: enter -> craft with table',
    shouldTransition: () => {
      return getItemCountInInventory(bot, targets.itemName) < targets.amount;
    },
    onTransition: () => {
      targets.amount = targets.amount - getItemCountInInventory(bot, targets.itemName);
      logger.info(
        `BehaviorCraftWithTableIfNeeded: enter -> craft with table: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`
      );
    }
  });

  const craftWithTableToExit = new StateTransition({
    parent: craftWithTableState,
    child: exit,
    name: 'BehaviorCraftWithTableIfNeeded: craft with table -> exit',
    shouldTransition: () => craftWithTableState.isFinished(),
    onTransition: () => {
      logger.info('BehaviorCraftWithTableIfNeeded: craft with table -> exit');
    }
  });

  const transitions = [enterToExit, enterToCraftWithTable, craftWithTableToExit];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createCraftWithTableIfNeeded;

