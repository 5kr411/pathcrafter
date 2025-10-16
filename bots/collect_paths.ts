const mineflayer = require('mineflayer');

import { getConfig } from './collector/config';
import { parseTargetsFromMessage } from './collector/chat_handler';
import { WorkerManager } from './collector/worker_manager';
import { TargetExecutor } from './collector/target_executor';
import { setSafeFindRepeatThreshold } from '../utils/config';
import { configurePrecisePathfinder } from '../utils/pathfinderConfig';
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

bot.once('spawn', () => {
  configurePrecisePathfinder(bot);
  
  if (Number.isFinite(config.safeFindRepeatThreshold)) {
    setSafeFindRepeatThreshold(Math.max(1, Math.floor(config.safeFindRepeatThreshold)));
  }

  const safeChat = (msg: string): void => {
    try {
      if (bot && bot._client && !bot._client.ended) bot.chat(msg);
    } catch (_) {}
  };

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

  let lastSequence: any[] | null = null;

  const workerManager = new WorkerManager(
    (entry, ranked, ok, error) => {
      if (!connected) return;
      executor.handlePlanningResult(entry, ranked, ok, error);
    },
    () => {}
  );

  const executor = new TargetExecutor(bot, workerManager, safeChat, {
    snapshotRadii: config.snapshotRadii,
    snapshotYHalf: config.snapshotYHalf,
    pruneWithWorld: config.pruneWithWorld,
    combineSimilarNodes: config.combineSimilarNodes,
    perGenerator: config.perGenerator
  });

  bot.on('end', () => {
    workerManager.terminate();
  });

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    const m = message.trim();
    const parts = m.split(/\s+/);
    if (parts[0] !== 'collect' && parts[0] !== 'go') return;

    if (parts[0] === 'go') {
      if (!Array.isArray(lastSequence) || lastSequence.length === 0) {
        safeChat('no previous collect request');
        return;
      }
      executor.setTargets(lastSequence.slice());
      if (executor.isRunning()) {
        safeChat('already running, please wait');
        return;
      }
      executor.startNextTarget().catch(() => {});
      return;
    }

    const parsed = parseTargetsFromMessage(message);
    if (!parsed || parsed.length === 0) {
      safeChat('usage: collect <item> <count>[, <item> <count> ...]');
      return;
    }
    lastSequence = parsed.slice();
    executor.setTargets(parsed.slice());
    if (executor.isRunning()) {
      safeChat('already running, please wait');
      return;
    }
    executor.startNextTarget().catch(() => {});
  });
});
