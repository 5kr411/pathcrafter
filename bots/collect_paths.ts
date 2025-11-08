const mineflayer = require('mineflayer');

import { getConfig } from './collector/config';
import { WorkerManager } from './collector/worker_manager';
import { TargetExecutor } from './collector/target_executor';
import { ToolReplacementExecutor } from './collector/tool_replacement_executor';
import { CommandHandler } from './collector/command_handler';
import { ReactiveBehaviorRegistry } from './collector/reactive_behavior_registry';
import { ReactiveBehaviorExecutorClass } from './collector/reactive_behavior_executor';
import { hostileMobBehavior } from './collector/reactive_behaviors/hostile_mob_behavior';
import { shieldDefenseBehavior } from './collector/reactive_behaviors/shield_defense_behavior';
import { armorUpgradeBehavior } from './collector/reactive_behaviors/armor_upgrade_behavior';
import { BehaviorScheduler } from './collector/behavior_scheduler';
import { setSafeFindRepeatThreshold, setLiquidAvoidanceDistance } from '../utils/config';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';
import { installExplosionSanitizer } from '../utils/explosionSanitizer';
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

bot.once('login', () => {
  installExplosionSanitizer(bot);
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

  let connected = true;
  bot.on('kicked', (reason: string) => {
    connected = false;
    logger.info('Collector: kicked', reason);
  });
  bot.on('end', () => {
    connected = false;
    logger.info('Collector: connection ended');
  });
  bot.on('error', (err: any) => {
    logger.info('Collector: bot error', err && err.code ? err.code : err);
  });

  safeChat('collector ready');

  let behaviorScheduler: BehaviorScheduler | null = null;
  let executor: TargetExecutor;

  const workerManager = new WorkerManager(
    (entry, ranked, ok, error, plannerId) => {
      if (!connected) return;
      if (behaviorScheduler) {
        behaviorScheduler.handlePlannerResult(entry, ranked, ok, error, plannerId);
      } else if (executor) {
        executor.handlePlanningResult(entry, ranked, ok, error);
      }
    },
    () => {}
  );

  const reactiveBehaviorRegistry = new ReactiveBehaviorRegistry();
  reactiveBehaviorRegistry.register(shieldDefenseBehavior);
  reactiveBehaviorRegistry.register(hostileMobBehavior);
  reactiveBehaviorRegistry.register(armorUpgradeBehavior);

  const reactiveBehaviorExecutor = new ReactiveBehaviorExecutorClass(bot, reactiveBehaviorRegistry);
  behaviorScheduler = new BehaviorScheduler(bot, workerManager);
  
  const toolReplacementExecutor = new ToolReplacementExecutor(bot, workerManager, behaviorScheduler, safeChat, {
    snapshotRadii: config.snapshotRadii,
    snapshotYHalf: config.snapshotYHalf,
    pruneWithWorld: config.pruneWithWorld,
    combineSimilarNodes: config.combineSimilarNodes,
    perGenerator: config.perGenerator,
    toolDurabilityThreshold: config.toolDurabilityThreshold
  });

  executor = new TargetExecutor(bot, workerManager, safeChat, {
    snapshotRadii: config.snapshotRadii,
    snapshotYHalf: config.snapshotYHalf,
    pruneWithWorld: config.pruneWithWorld,
    combineSimilarNodes: config.combineSimilarNodes,
    perGenerator: config.perGenerator,
    toolDurabilityThreshold: config.toolDurabilityThreshold
  }, reactiveBehaviorExecutor, toolReplacementExecutor);

  behaviorScheduler.pushBehavior(executor);
  behaviorScheduler.activateTop().catch(() => {});

  behaviorScheduler.setReactivePoller(async () => {
    if (!reactiveBehaviorExecutor) {
      return;
    }
    const behavior = await reactiveBehaviorExecutor.registry.findActiveBehavior(bot);
    if (!behavior) {
      return;
    }
    const run = await reactiveBehaviorExecutor.createScheduledRun(behavior);
    if (!run) {
      return;
    }
    try {
      await behaviorScheduler.pushAndActivate(run, `reactive ${behavior.name || 'unknown'}`);
      await run.waitForCompletion();
    } catch (err: any) {
      logger.info(`Collector: reactive behavior orchestration error - ${err?.message || err}`);
    }
  });

  bot.on('death', () => {
    logger.info('Collector: bot died, resetting and retrying all targets');
    if (executor.isRunning() || executor.getTargets().length > 0) {
      executor.resetAndRestart();
    }
  });

  bot.on('end', () => {
    workerManager.terminate();
  });

  const commandHandler = new CommandHandler(bot, executor, safeChat);

  bot.on('chat', (username: string, message: string) => {
    commandHandler.handleChatMessage(username, message);
  });
});
