const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import { getItemCountInInventory } from '../utils/inventory';
import createCollectBlockState from './behaviorCollectBlock';

import logger from '../utils/logger';

type Bot = any;

interface Targets {
  itemName: string;
  amount: number;
  blockName: string;
  [key: string]: any;
}

function createCollectBlockIfNeededState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const collectBlock = createCollectBlockState(bot, targets);
  const exit = new BehaviorIdle();

  const enterToExit = new StateTransition({
    name: 'BehaviorCollectBlockIfNeeded: enter -> exit',
    parent: enter,
    child: exit,
    shouldTransition: () => {
      return getItemCountInInventory(bot, targets.itemName) >= targets.amount;
    },
    onTransition: () => {
      logger.info(
        `BehaviorCollectBlockIfNeeded: enter -> exit: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`
      );
    }
  });

  const enterToCollectBlock = new StateTransition({
    name: 'BehaviorCollectBlockIfNeeded: enter -> collect block',
    parent: enter,
    child: collectBlock,
    shouldTransition: () => {
      return getItemCountInInventory(bot, targets.itemName) < targets.amount;
    },
    onTransition: () => {
      targets.amount = targets.amount - getItemCountInInventory(bot, targets.itemName);
      logger.info(
        `BehaviorCollectBlockIfNeeded: enter -> collect block: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`
      );
    }
  });

  const collectBlockToExit = new StateTransition({
    name: 'BehaviorCollectBlockIfNeeded: collect block -> exit',
    parent: collectBlock,
    child: exit,
    shouldTransition: () => collectBlock.isFinished(),
    onTransition: () => {
      logger.info(
        `BehaviorCollectBlockIfNeeded: collect block -> exit: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`
      );
    }
  });

  const transitions = [enterToExit, enterToCollectBlock, collectBlockToExit];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createCollectBlockIfNeededState;

