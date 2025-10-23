const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');

import createCraftNoTableState from '../behaviors/behaviorCraftNoTable';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'craft_inventory_bot'
};

if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);
  
  const targets: any = {};

  const enter = new BehaviorIdle();
  const craftNoTable = createCraftNoTableState(bot, targets);
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'craft-inventory: enter -> craft',
    parent: enter,
    child: craftNoTable,
    shouldTransition: () => false,
    onTransition: () => {
      if (!targets.itemName) targets.itemName = 'stick';
      if (!targets.amount) targets.amount = 4;
      bot.chat(`Starting craft in inventory: ${targets.amount} ${targets.itemName}`);
    }
  });

  const craftToExit = new StateTransition({
    name: 'craft-inventory: craft -> exit',
    parent: craftNoTable,
    child: exit,
    shouldTransition: () => craftNoTable.isFinished && craftNoTable.isFinished(),
    onTransition: () => {
      bot.chat('Craft in inventory complete (or timed out)');
    }
  });

  const exitToEnter = new StateTransition({
    name: 'craft-inventory: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true,
    onTransition: () => {
      // reset/keep targets as-is; next startTransition will (re)use them
    }
  });

  const transitions = [startTransition, craftToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'craft_inventory_root';

  // Wire chat control: wait for "go"
  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const parts = message.trim().split(/\s+/);
    if (parts[0] === 'craft') {
      if (parts[1]) targets.itemName = parts[1];
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
