const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');
const { Vec3 } = require('vec3');

import createSmartMoveToState from '../behaviors/behaviorSmartMoveTo';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';
import { configureBaritone } from '../utils/baritoneConfig';

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'smart_move_bot'
};

if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('@miner-org/mineflayer-baritone').loader);

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);
  configureBaritone(bot);
  
  const targets: any = {};

  const enter = new BehaviorIdle();
  const moveToPosition = createSmartMoveToState(bot, targets);
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'smart-move: enter -> move',
    parent: enter,
    child: moveToPosition,
    shouldTransition: () => false,
    onTransition: () => {
      if (targets.position) {
        bot.chat(`Starting smart move to (${targets.position.x}, ${targets.position.y}, ${targets.position.z})`);
      }
    }
  });

  const moveToExit = new StateTransition({
    name: 'smart-move: move -> exit',
    parent: moveToPosition,
    child: exit,
    shouldTransition: () => moveToPosition.isFinished && moveToPosition.isFinished(),
    onTransition: () => {
      bot.chat(`Smart move complete!`);
    }
  });

  const exitToEnter = new StateTransition({
    name: 'smart-move: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  });

  const transitions = [startTransition, moveToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'smart_move_root';

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const parts = message.trim().split(/\s+/);
    if (parts[0] === 'move') {
      if (parts.length >= 4) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          targets.position = new Vec3(x, y, z);
          setTimeout(() => startTransition.trigger(), 0);
        } else {
          bot.chat('Invalid coordinates');
        }
      } else {
        bot.chat('Usage: move <x> <y> <z>');
      }
    }
  });

  new BotStateMachine(bot, root);
});

export {};

