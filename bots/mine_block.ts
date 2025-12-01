const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');

import createCollectBlockState from '../behaviors/behaviorCollectBlock';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'mine_block_bot'
};

if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('mineflayer-tool').plugin);

bot.once('spawn', () => {
  const targets: any = {};

  const enter = new BehaviorIdle();
  // Ensure defaults exist before constructing the collect behavior
  if (!targets.blockName) targets.blockName = 'stone';
  if (!targets.itemName) targets.itemName = 'cobblestone';
  if (!targets.amount) targets.amount = 1;
  const collect = createCollectBlockState(bot, targets);
  configurePrecisePathfinder(bot);
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'mine-block: enter -> collect',
    parent: enter,
    child: collect,
    shouldTransition: () => false,
    onTransition: () => {
      if (!targets.blockName) targets.blockName = 'stone';
      if (!targets.itemName) targets.itemName = 'cobblestone';
      if (!targets.amount) targets.amount = 1;
      bot.chat(`Starting mine: ${targets.amount} ${targets.itemName} from ${targets.blockName}`);
    }
  });

  const collectToExit = new StateTransition({
    name: 'mine-block: collect -> exit',
    parent: collect,
    child: exit,
    shouldTransition: () => collect.isFinished && collect.isFinished(),
    onTransition: () => {
      bot.chat('Mining complete (or timed out)');
    }
  });

  const exitToEnter = new StateTransition({
    name: 'mine-block: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  });

  const transitions = [startTransition, collectToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'mine_block_root';

  // Wire chat control: wait for "go"
  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const parts = message.trim().split(/\s+/);
    if (parts[0] === 'mine') {
      if (parts[1]) {
        targets.blockName = parts[1];
        // Default drop target to the block name for e2e simplicity
        targets.itemName = parts[1];
      }
      if (parts[2]) {
        const n = parseInt(parts[2]);
        if (!Number.isNaN(n)) targets.amount = n;
      }
      setTimeout(() => startTransition.trigger(), 0);
    }
  });

  new BotStateMachine(bot, root);
});


export {};
