const mineflayer = require('mineflayer');

import { getConfig } from './collector/config';
import { WorkerManager } from './collector/worker_manager';
import { CommandHandler } from './collector/command_handler';
import { ReactiveBehaviorRegistry } from './collector/reactive_behavior_registry';
import { hostileMobBehavior } from './collector/reactive_behaviors/hostile_mob_behavior';
import { shieldDefenseBehavior } from './collector/reactive_behaviors/shield_defense_behavior';
import { armorUpgradeBehavior } from './collector/reactive_behaviors/armor_upgrade_behavior';
import { foodEatingBehavior } from './collector/reactive_behaviors/food_eating_behavior';
import { foodCollectionBehavior, setFoodCollectionConfig } from './collector/reactive_behaviors/food_collection_behavior';
import { foodSmeltingBehavior } from './collector/reactive_behaviors/food_smelting_behavior';
import { CollectorControlStack } from './collector/control_stack';
import { setSafeFindRepeatThreshold, setLiquidAvoidanceDistance } from '../utils/config';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';
import { installExplosionSanitizer } from '../utils/explosionSanitizer';
import { installPacketErrorSuppressor } from '../utils/packetErrorSuppressor';
import logger from '../utils/logger';

const config = getConfig();

if (!process.env.LOG_LEVEL) {
  logger.setLevel(config.logLevel);
}

let botOptions: any = { host: 'localhost', port: 25565, username: 'collector' };
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot: any = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('mineflayer-pvp').plugin);
bot.loadPlugin(require('mineflayer-tool').plugin);

bot.once('login', () => {
  installExplosionSanitizer(bot);
  installPacketErrorSuppressor(bot);
});

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);
  
  if (Number.isFinite(config.safeFindRepeatThreshold)) {
    setSafeFindRepeatThreshold(Math.max(1, Math.floor(config.safeFindRepeatThreshold)));
  }

  if (Number.isFinite(config.liquidAvoidanceDistance)) {
    setLiquidAvoidanceDistance(Math.max(0, Math.floor(config.liquidAvoidanceDistance)));
  }

  const safeChat = (msg: string): void => {
    try {
      if (bot && bot._client && !bot._client.ended) bot.chat(msg);
    } catch (_) {}
  };

  (bot as any).safeChat = safeChat;

  bot.on('kicked', (reason: string) => {
    logger.info('Collector: kicked', reason);
  });
  bot.on('end', () => {
    logger.info('Collector: connection ended');
  });
  bot.on('error', (err: any) => {
    logger.info('Collector: bot error', err && err.code ? err.code : err);
  });

  safeChat('collector ready');

  const workerManager = new WorkerManager(
    () => {
      // Planning handlers are passed per request; ignore fallback results.
    },
    () => {}
  );

  const reactiveBehaviorRegistry = new ReactiveBehaviorRegistry();
  setFoodCollectionConfig({ triggerFoodPoints: 20, targetFoodPoints: 40 });
  reactiveBehaviorRegistry.register(shieldDefenseBehavior);
  reactiveBehaviorRegistry.register(hostileMobBehavior);
  reactiveBehaviorRegistry.register(armorUpgradeBehavior);
  reactiveBehaviorRegistry.register(foodCollectionBehavior);
  reactiveBehaviorRegistry.register(foodEatingBehavior);
  reactiveBehaviorRegistry.register(foodSmeltingBehavior);

  const controlStack = new CollectorControlStack(
    bot,
    workerManager,
    safeChat,
    {
      snapshotRadii: config.snapshotRadii,
      snapshotYHalf: config.snapshotYHalf,
      pruneWithWorld: config.pruneWithWorld,
      combineSimilarNodes: config.combineSimilarNodes,
      perGenerator: config.perGenerator,
      toolDurabilityThreshold: config.toolDurabilityThreshold
    },
    reactiveBehaviorRegistry
  );
  controlStack.start();
  const executor = controlStack.targetLayer;

  bot.on('death', () => {
    logger.info('Collector: bot died, resetting and retrying all targets');
    if (executor.isRunning() || executor.getTargets().length > 0) {
      executor.resetAndRestart();
    }
  });

  bot.on('end', () => {
    workerManager.terminate();
    controlStack.stop();
  });

  const commandHandler = new CommandHandler(bot, executor, safeChat);

  bot.on('chat', (username: string, message: string) => {
    commandHandler.handleChatMessage(username, message);
  });
});
