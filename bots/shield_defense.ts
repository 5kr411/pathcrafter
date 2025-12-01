const mineflayer = require('mineflayer');
const { StateTransition, BehaviorIdle, NestedStateMachine, BotStateMachine } = require('mineflayer-statemachine');

import { createShieldDefenseState } from '../behaviors/behaviorShieldDefense';
import { ensureShieldEquipped, findShieldItem, findClosestCreeper, shouldContinueShieldDefense } from './collector/reactive_behaviors/shield_defense_behavior';
import { findClosestHostileMob, getHostileMobNames } from './collector/reactive_behaviors/hostile_mob_behavior';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';

const minecraftData = require('minecraft-data');

let botOptions: any = {
  host: 'localhost',
  port: 25565,
  username: 'shield-tester'
};

if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('mineflayer-pvp').plugin);
bot.loadPlugin(require('mineflayer-tool').plugin);

bot.on('error', (err: any) => {
  console.error('ShieldDefense bot error:', err);
});

bot.on('kicked', (reason: string) => {
  console.error('ShieldDefense bot kicked:', reason);
});

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);

  const buildHostileSet = (): Set<string> => {
    try {
      const mcData = minecraftData(bot.version);
      const names = getHostileMobNames(mcData);
      const set = new Set<string>();
      for (const name of names) {
        if (!name) continue;
        set.add(String(name).toLowerCase());
      }
      set.add('creeper');
      return set;
    } catch (err) {
      console.warn('ShieldDefense: unable to build hostile set, using fallback', err);
      return new Set<string>(['creeper', 'zombie', 'skeleton', 'spider', 'drowned']);
    }
  };

  const hostileNameSet = buildHostileSet();

  const targets: any = {
    entity: null,
    entityFilter: (entity: any) => {
      const name = String(entity?.name || entity?.displayName || '').toLowerCase();
      if (!name) return false;
      return hostileNameSet.has(name);
    },
    detectionRange: 32,
    attackRange: 3.5,
    fastAttack: true
  };

  const reacquireThreat = (): any | null => {
    const creeper = findClosestCreeper(bot, 7);
    if (creeper) {
      return creeper;
    }
    try {
      return findClosestHostileMob(bot, 32);
    } catch (err) {
      console.warn('ShieldDefense: threat lookup failed', err);
      return null;
    }
  };

  const shieldDefenseState = createShieldDefenseState(bot, {
    targets,
    reacquireThreat,
    holdDurationMs: 5000,
    shouldContinue: () => shouldContinueShieldDefense(bot)
  });

  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();

  const startTransition = new StateTransition({
    name: 'shield-defense: enter -> active',
    parent: enter,
    child: shieldDefenseState,
    shouldTransition: () => false,
    onTransition: () => {
      bot.chat('Shield defense behavior activated');
    }
  });

  const shieldToExit = new StateTransition({
    name: 'shield-defense: active -> exit',
    parent: shieldDefenseState,
    child: exit,
    shouldTransition: () => {
      if (typeof shieldDefenseState.isFinished === 'function') {
        return shieldDefenseState.isFinished();
      }
      return shieldDefenseState.isFinished === true;
    },
    onTransition: () => {
      bot.chat('Shield defense behavior finished');
      targets.entity = null;
      executing = false;
    }
  });

  const exitToEnter = new StateTransition({
    name: 'shield-defense: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true
  });

  const transitions = [startTransition, shieldToExit, exitToEnter];
  const root = new NestedStateMachine(transitions, enter);
  root.name = 'shield_defense_test';

  let executing = false;

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    const [commandRaw] = trimmed.split(/\s+/);
    const command = commandRaw.toLowerCase();

    if (command === 'shield') {
      if (executing) {
        bot.chat('Shield defense already running.');
        return;
      }

      const shieldItem = findShieldItem(bot);
      if (!shieldItem) {
        bot.chat('No shield detected in inventory.');
        return;
      }

      executing = true;
      targets.entity = null;
      bot.chat('Preparing shield defense cycle...');

      void (async () => {
        const equipped = await ensureShieldEquipped(bot, shieldItem);
        if (!equipped) {
          bot.chat('Unable to equip shield automatically. Equip it and try again.');
          executing = false;
          return;
        }

        bot.chat('Starting shield defense cycle...');
        setTimeout(() => startTransition.trigger(), 0);
      })();
    } else if (command === 'threats') {
      const creeper = findClosestCreeper(bot, 8);
      try {
        const hostile = findClosestHostileMob(bot, 32);
        const parts: string[] = [];
        if (creeper) {
          const dist = bot.entity?.position?.distanceTo?.(creeper.position)?.toFixed(1) ?? '?';
          parts.push(`creeper@${dist}m`);
        }
        if (hostile && hostile !== creeper) {
          const dist = bot.entity?.position?.distanceTo?.(hostile.position)?.toFixed(1) ?? '?';
          const label = hostile.displayName || hostile.name || 'unknown';
          parts.push(`${label}@${dist}m`);
        }
        bot.chat(parts.length > 0 ? `Threats: ${parts.join(', ')}` : 'No threats detected.');
      } catch (err) {
        bot.chat('Unable to evaluate threats right now.');
      }
    } else if (command === 'help') {
      bot.chat('Commands: shield, threats, help');
    }
  });

  new BotStateMachine(bot, root);
  console.log('Shield defense test bot ready. Type "shield" in chat to start.');
});

export {};



