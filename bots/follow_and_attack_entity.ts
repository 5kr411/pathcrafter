const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');

import createFollowAndAttackEntityState from '../behaviors/behaviorFollowAndAttackEntity';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'follow-attacker'
};

if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

console.log('Creating bot with options:', botOptions);
const bot = mineflayer.createBot(botOptions);

bot.on('error', (err: any) => {
  console.error('Bot error:', err);
});

bot.on('kicked', (reason: string) => {
  console.error('Bot kicked:', reason);
});

bot.on('end', () => {
  console.log('Bot disconnected');
});

console.log('Loading pathfinder plugin...');
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);

console.log('Loading tool plugin...');
bot.loadPlugin(require('mineflayer-tool').plugin);

console.log('Setting up spawn handler...');
bot.once('spawn', () => {
  console.log('Bot spawned successfully!');
  const targets: any = {
    entity: null,
    entityFilter: null,
    detectionRange: 32,
  };

  const enter = new BehaviorIdle();
  const followAndAttack = createFollowAndAttackEntityState(bot, targets);
  configurePrecisePathfinder(bot);
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'follow-attack: enter -> follow and attack',
    parent: enter,
    child: followAndAttack,
    shouldTransition: () => false,
    onTransition: () => {
      bot.chat(`Starting follow and attack`);
    }
  });

  const followAttackToExit = new StateTransition({
    name: 'follow-attack: follow and attack -> exit',
    parent: followAndAttack,
    child: exit,
    shouldTransition: () => {
      if (typeof followAndAttack.isFinished === 'function') {
        return followAndAttack.isFinished();
      }
      return followAndAttack.isFinished === true;
    },
    onTransition: () => {
      bot.chat('Follow and attack complete (or timed out)');
      targets.entity = null;
      isExecuting = false;
    }
  });

  const exitToEnter = new StateTransition({
    name: 'follow-attack: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  });

  const transitions = [startTransition, followAttackToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'follow_attack_root';

  let isExecuting = false;

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const parts = message.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    
    if (command === 'follow-attack' || command === 'followattack') {
      if (isExecuting) {
        bot.chat('Already executing follow-attack, please wait...');
        return;
      }
      const entityName = parts.slice(1).join('_') || 'zombie';
      
      targets.entityFilter = (entity: any) => {
        const name = (entity.name || '').toLowerCase();
        const displayName = (entity.displayName || '').toLowerCase();
        const entityNameLower = entityName.toLowerCase().replace(/ /g, '_');
        return name === entityNameLower || displayName === entityNameLower;
      };

      bot.chat(`Following and attacking ${entityName}`);
      targets.entity = null;
      isExecuting = true;
      setTimeout(() => startTransition.trigger(), 0);
    } else if (command === 'attack' || command === 'atk') {
      const entityName = parts.slice(1).join('_') || 'zombie';
      
      const entities = Object.values(bot.entities || {});
      const targetEntity = entities.find((e: any) => {
        const entityNameLower = entityName.toLowerCase().replace(/ /g, '_');
        const name = (e.name || '').toLowerCase();
        const displayName = (e.displayName || '').toLowerCase();
        return name === entityNameLower || displayName === entityNameLower;
      }) as any;

      if (targetEntity) {
        targets.entity = targetEntity;
        targets.entityFilter = (entity: any) => {
          return entity === targetEntity;
        };
        const foundName = targetEntity.name || targetEntity.displayName || entityName;
        bot.chat(`Targeting specific ${foundName}`);
        setTimeout(() => startTransition.trigger(), 0);
      } else {
        const nearby = entities.map((e: any) => (e.name || e.displayName || 'unknown')).slice(0, 5);
        bot.chat(`No ${entityName} found nearby. Nearby entities: ${nearby.join(', ')}`);
      }
    } else if (command === 'list' || command === 'entities') {
      const entities = Object.values(bot.entities || {});
      const entityList = entities.map((e: any) => {
        const name = e.name || e.displayName || 'unknown';
        const dist = bot.entity?.position?.distanceTo?.(e.position)?.toFixed(1) || '?';
        return `${name} (${dist}m)`;
      }).slice(0, 10);
      bot.chat(`Nearby entities: ${entityList.join(', ')}`);
    }
  });

  new BotStateMachine(bot, root);
  console.log('Bot ready for commands. Type "follow-attack <entity_name>" or "list" to see nearby entities.');
});

console.log('Waiting for spawn event...');


export {};

