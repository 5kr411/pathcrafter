const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');

import createHuntEntityState from '../behaviors/behaviorHuntEntity';

const botOptions = {
  host: process.env.SERVER_HOST || 'localhost',
  port: parseInt(process.env.SERVER_PORT || '25565'),
  username: 'hunter'
};

console.log('Creating bot with options:', botOptions);

const bot = mineflayer.createBot(botOptions);

console.log('Loading pathfinder plugin...');
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);

console.log('Loading pvp plugin...');
bot.loadPlugin(require('mineflayer-pvp').plugin);

console.log('Loading tool plugin...');
bot.loadPlugin(require('mineflayer-tool').plugin);

function configurePrecisePathfinder(bot: any) {
  const pathfinder = bot.pathfinder;
  if (pathfinder && pathfinder.setMovements) {
    const mcData = require('minecraft-data')(bot.version);
    const { Movements } = require('mineflayer-pathfinder');
    const movements = new Movements(bot, mcData);
    movements.canDig = false;
    movements.allow1by1towers = false;
    pathfinder.setMovements(movements);
  }
}

console.log('Setting up spawn handler...');
bot.once('spawn', () => {
  console.log('Bot spawned successfully!');
  const targets: any = {
    entity: null,
    entityFilter: null,
    detectionRange: 32,
  };

  const enter = new BehaviorIdle();
  const huntEntity = createHuntEntityState(bot, targets);
  configurePrecisePathfinder(bot);
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'hunt: enter -> hunt entity',
    parent: enter,
    child: huntEntity,
    shouldTransition: () => false,
    onTransition: () => {
      bot.chat(`Starting hunt`);
    }
  });

  const huntToExit = new StateTransition({
    name: 'hunt: hunt entity -> exit',
    parent: huntEntity,
    child: exit,
    shouldTransition: () => {
      if (typeof huntEntity.isFinished === 'function') {
        return huntEntity.isFinished();
      }
      return huntEntity.isFinished === true;
    },
    onTransition: () => {
      bot.chat('Hunt complete');
      targets.entity = null;
      isExecuting = false;
    }
  });

  const exitToEnter = new StateTransition({
    name: 'hunt: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  });

  const transitions = [startTransition, huntToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'hunt_root';

  let isExecuting = false;

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const parts = message.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    
    if (command === 'hunt') {
      if (isExecuting) {
        bot.chat('Already hunting, please wait...');
        return;
      }
      const entityName = parts.slice(1).join('_') || 'zombie';
      
      targets.entityFilter = (entity: any) => {
        const name = (entity.name || '').toLowerCase();
        const displayName = (entity.displayName || '').toLowerCase();
        const entityNameLower = entityName.toLowerCase().replace(/ /g, '_');
        return name === entityNameLower || displayName === entityNameLower;
      };

      bot.chat(`Hunting ${entityName}`);
      targets.entity = null;
      isExecuting = true;
      setTimeout(() => startTransition.trigger(), 0);
    } else if (command === 'list' || command === 'entities') {
      const entities = Object.values(bot.entities || {});
      const entityList = entities.map((e: any) => {
        const name = e.displayName || e.name || e.username || 'unknown';
        const dist = bot.entity?.position?.distanceTo(e.position).toFixed(1) || '?';
        return `${name} (${dist}m)`;
      }).slice(0, 10);
      bot.chat(`Nearby entities: ${entityList.join(', ')}`);
    }
  });

  new BotStateMachine(bot, root);
  console.log('Bot ready for commands. Type "hunt <entity_name>" or "list" to see nearby entities.');
});

console.log('Waiting for spawn event...');

bot.on('error', (err: Error) => console.error('Bot error:', err));
bot.on('end', () => console.log('Bot disconnected'));

export {};

