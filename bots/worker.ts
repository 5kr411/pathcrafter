import { workerData, parentPort, isMainThread } from 'worker_threads';

const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');

import createCollectItemState from '../behaviors/behaviorCollectBlock';

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'Bot'
};

if (isMainThread) {
  if (process.argv.length >= 4) {
    botOptions.host = process.argv[2];
    botOptions.port = parseInt(process.argv[3]);
    if (process.argv[4]) botOptions.username = process.argv[4];
    if (process.argv[5]) botOptions.password = process.argv[5];
  }
} else if (workerData) {
  Object.assign(botOptions, {
    host: workerData.host,
    port: workerData.port,
    username: workerData.username,
    password: workerData.password
  });
}

const bot = mineflayer.createBot(botOptions);

bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
import logger from '../utils/logger';

async function main(): Promise<void> {
  bot.once('spawn', () => {
    if (!isMainThread && parentPort) {
      parentPort.on('message', (_message: any) => {
        // logger.info('received message: ', _message)
        // Handle worker-specific message logic
      });
    }

    let targets: any = {};

    const enter = new BehaviorIdle();

    if (!targets.itemName) targets.itemName = 'cobblestone';
    if (!targets.amount) targets.amount = 1;
    if (!targets.blockName) targets.blockName = targets.itemName;

    const collectItemState = createCollectItemState(bot, targets);

    const exit = new BehaviorIdle();

    const enterToCollectItem = new StateTransition({
      name: 'worker: enter -> collect item',
      parent: enter,
      child: collectItemState,
      shouldTransition: () => true,
      onTransition: () => {
        logger.info('worker: enter -> collect item');
        if (!targets.itemName) targets.itemName = 'cobblestone';
        if (!targets.amount) targets.amount = 1;
        if (!targets.blockName) targets.blockName = targets.itemName;
      }
    });

    const collectItemToExit = new StateTransition({
      name: 'worker: collect item -> exit',
      parent: collectItemState,
      child: exit,
      shouldTransition: () => collectItemState.isFinished(),
      onTransition: () => {
        logger.info('worker: collect item -> exit');
      }
    });

    const exitToEnter = new StateTransition({
      name: 'worker: exit -> enter',
      parent: exit,
      child: enter,
      shouldTransition: () => false,
      onTransition: () => {
        logger.info('worker: exit -> enter');
      }
    });

    const transitions = [enterToCollectItem, collectItemToExit, exitToEnter];

    const root = new NestedStateMachine(transitions, enter);
    root.name = 'main';

    new BotStateMachine(bot, root);

    bot.on('chat', (username: string, message: string) => {
      if (username === bot.username) return;

      const parts = message.split(' ');

      if (parts[0] === 'go') {
        exitToEnter.trigger();
      }

      if (parts[0] === 'collect') {
        exitToEnter.trigger();
        targets.itemName = parts[1];
        targets.amount = parseInt(parts[2]);
        targets.blockName = targets.itemName;
      }
    });
  });
}

main();


export {};
