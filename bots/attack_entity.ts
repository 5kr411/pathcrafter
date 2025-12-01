const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');

import createAttackEntityState from '../behaviors/behaviorAttackEntity';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'attacker'
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
  const targets: any = {
    entity: null
  };

  const enter = new BehaviorIdle();
  const attack = createAttackEntityState(bot, targets);
  configurePrecisePathfinder(bot);
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'attack-entity: enter -> attack',
    parent: enter,
    child: attack,
    shouldTransition: () => false,
    onTransition: () => {
      bot.chat(`Starting attack on entity`);
    }
  });

  const attackToExit = new StateTransition({
    name: 'attack-entity: attack -> exit',
    parent: attack,
    child: exit,
    shouldTransition: () => {
      if (typeof attack.isFinished === 'function') {
        return attack.isFinished();
      }
      return attack.isFinished === true;
    },
    onTransition: () => {
      bot.chat('Attack complete (or timed out)');
      targets.entity = null;
    }
  });

  const exitToEnter = new StateTransition({
    name: 'attack-entity: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  });

  const transitions = [startTransition, attackToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'attack_entity_root';

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const parts = message.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    
    if (command === 'attack' || command === 'atk') {
      const entityName = parts.slice(1).join('_') || 'zombie';
      
      const entities = Object.values(bot.entities || {});
      const targetEntity = entities.find((e: any) => {
        const name = (e.name || e.displayName || '').toLowerCase();
        const entityNameLower = entityName.toLowerCase().replace(/ /g, '_');
        return name === entityNameLower || name.includes(entityNameLower) || entityNameLower.includes(name.split('_')[0]);
      }) as any;

      if (targetEntity) {
        targets.entity = targetEntity;
        const foundName = targetEntity.name || targetEntity.displayName || entityName;
        bot.chat(`Targeting ${foundName}`);
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
});


export {};

