const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');
const { Vec3 } = require('vec3');

import createMineflayerMoveToState from '../behaviors/behaviorMineflayerMoveTo';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'mineflayer_move_bot'
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
  const moveToPosition = createMineflayerMoveToState(bot, targets);
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'mineflayer-move: enter -> move',
    parent: enter,
    child: moveToPosition,
    shouldTransition: () => false,
    onTransition: () => {
      if (targets.position) {
        bot.chat(`Starting mineflayer move to (${targets.position.x}, ${targets.position.y}, ${targets.position.z})`);
      }
    }
  });

  const moveToExit = new StateTransition({
    name: 'mineflayer-move: move -> exit',
    parent: moveToPosition,
    child: exit,
    shouldTransition: () => moveToPosition.isFinished && moveToPosition.isFinished(),
    onTransition: () => {
      const distance = moveToPosition.distanceToTarget();
      if (distance < 1) {
        bot.chat(`Mineflayer move complete! Reached destination.`);
      } else {
        bot.chat(`Mineflayer move finished but ${distance.toFixed(2)}m from goal`);
      }
    }
  });

  const exitToEnter = new StateTransition({
    name: 'mineflayer-move: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  });

  const transitions = [startTransition, moveToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'mineflayer_move_root';

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

