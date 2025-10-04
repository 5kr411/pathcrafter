import { Worker } from 'worker_threads';
import * as path from 'path';

const mineflayer = require('mineflayer');
const { BotStateMachine } = require('mineflayer-statemachine');
const minecraftData = require('minecraft-data');

const { buildStateMachineForPath } = require('../behavior_generator/buildMachine');
const { plan: planner, _internals: plannerInternals } = require('../planner');
const { captureAdaptiveSnapshot } = require('../utils/adaptiveSnapshot');
const { setLastSnapshotRadius } = require('../utils/context');
const { setSafeFindRepeatThreshold } = require('../utils/config');
import logger from '../utils/logger';

// Type definitions
interface RuntimeConfig {
  pruneWithWorld: boolean;
  perGenerator: number;
  snapshotRadii: number[];
  snapshotYHalf: number | null;
  logLevel: string;
  progressLogIntervalMs: number;
  safeFindRepeatThreshold: number;
  usePersistentWorker: boolean;
}

interface Target {
  item: string;
  count: number;
}

interface InventoryObject {
  [itemName: string]: number;
}

interface Snapshot {
  radius: number;
  blocks?: { [blockName: string]: any };
  entities?: { [entityName: string]: any };
  [key: string]: any;
}

interface SnapshotOptions {
  radii: number[];
  yMin?: number;
  yMax?: number;
}

interface AdaptiveSnapshotResult {
  snapshot: Snapshot;
  radiusUsed: number;
  attemptsCount: number;
}

interface WorkerMessage {
  type: string;
  id?: string;
  ok?: boolean;
  error?: string;
  ranked?: any[];
  [key: string]: any;
}

interface PendingEntry {
  snapshot: Snapshot;
  target: Target;
}

type Bot = any;

// Centralized tunables for this bot. Adjust here.
const RUNTIME: RuntimeConfig = {
  pruneWithWorld: true,
  perGenerator: 1000,
  snapshotRadii: [16, 32, 64, 96], // Adaptive radii: tries smallest first, increases if needed
  snapshotYHalf: null,
  logLevel: 'DEBUG', // 'DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'
  progressLogIntervalMs: 250,
  safeFindRepeatThreshold: 10,
  // Worker pool settings (enumerator pool size is set in planning_worker.ts)
  usePersistentWorker: true // Keep planning worker alive between commands
};

// Set logger level from config (can be overridden by LOG_LEVEL env var)
if (!process.env.LOG_LEVEL) {
  logger.setLevel(RUNTIME.logLevel);
}

function logDebug(msg: string, ...args: any[]): void {
  logger.debug(msg, ...args);
}

function logInfo(msg: string, ...args: any[]): void {
  logger.info(msg, ...args);
}

function getInventoryObject(bot: Bot): InventoryObject {
  const out: InventoryObject = {};
  try {
    const items = bot.inventory?.items() || [];
    for (const it of items) {
      if (!it || !it.name || !Number.isFinite(it.count)) continue;
      out[it.name] = (out[it.name] || 0) + it.count;
    }
  } catch (_) {}
  return out;
}

let botOptions: any = { host: 'localhost', port: 25565, username: 'collector' };
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2];
  botOptions.port = parseInt(process.argv[3]);
  if (process.argv[4]) botOptions.username = process.argv[4];
  if (process.argv[5]) botOptions.password = process.argv[5];
}

const bot: Bot = mineflayer.createBot(botOptions);
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);

bot.once('spawn', () => {
  if (Number.isFinite(RUNTIME.safeFindRepeatThreshold)) {
    setSafeFindRepeatThreshold(Math.max(1, Math.floor(RUNTIME.safeFindRepeatThreshold)));
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

  let running = false;
  let lastSequence: Target[] | null = null;
  let worker: Worker | null = null;
  let pending = new Map<string, PendingEntry>();
  let sequenceTargets: Target[] = [];
  let sequenceIndex = 0;
  let workerReady = false;

  function ensureWorker(): Worker {
    if (worker && workerReady) {
      logDebug('Collector: reusing existing worker');
      return worker;
    }
    if (worker && !workerReady) {
      logDebug('Collector: worker exists but not ready yet');
      return worker;
    }
    const workerPath = path.resolve(__dirname, '../workers/planning_worker.js');
    logDebug(`Collector: creating persistent planning worker at ${workerPath}`);
    worker = new Worker(workerPath);
    workerReady = true;
    worker.on('message', (msg: WorkerMessage) => {
      logDebug(`Collector: worker message received: ${JSON.stringify(msg?.type)}`);
      if (!msg || msg.type !== 'result') {
        logDebug(`Collector: ignoring non-result message`);
        return;
      }
      const entry = pending.get(msg.id!);
      pending.delete(msg.id!);
      if (!entry) {
        logDebug(`Collector: no pending entry for id ${msg.id}`);
        return;
      }
      logDebug(`Collector: processing result for id ${msg.id}, ok=${msg.ok}`);
      if (!msg.ok) {
        running = false;
        const errorMsg = msg.error ? String(msg.error) : 'unknown error';
        logger.info(`Collector: planning failed - ${errorMsg}`);
        safeChat('planning failed');
        return;
      }
      const ranked = Array.isArray(msg.ranked) ? msg.ranked : [];
      logDebug(`Collector: received ${ranked.length} ranked paths`);
      if (ranked.length === 0) {
        // Treat as success if inventory already satisfies the target request
        try {
          const target = entry && entry.target ? entry.target : null;
          const invNow = getInventoryObject(bot);
          let have = 0;
          if (target && target.item) {
            const name = String(target.item);
            if (name.startsWith('generic_')) {
              const base = name.slice('generic_'.length);
              try {
                const mcDataNow = minecraftData(bot.version || '1.20.1');
                const speciesTokens = new Set<string>();
                try {
                  const { ensureWoodSpeciesTokens } = require('../utils/wood');
                  const ensured = ensureWoodSpeciesTokens(mcDataNow);
                  ensured && ensured.forEach && ensured.forEach((t: string) => speciesTokens.add(t));
                } catch (_) {}
                for (const [k, v] of Object.entries(invNow)) {
                  const idx = k.lastIndexOf('_');
                  if (idx <= 0) continue;
                  const prefix = k.slice(0, idx);
                  const suffix = k.slice(idx + 1);
                  if (suffix === base && speciesTokens.has(prefix)) have += v;
                }
              } catch (_) {}
            } else {
              have = invNow[name] || 0;
            }
          }
          if (target && Number.isFinite(target.count) && have >= target.count) {
            running = false;
            safeChat('target already satisfied');
            try {
              startNextTarget();
            } catch (_) {}
            return;
          }
        } catch (_) {}
        running = false;
        safeChat('no viable paths found');
        return;
      }
      const best = ranked[0];
      logInfo(`Collector: executing plan with ${best.length} steps`);
      safeChat(`executing plan with ${best.length} steps`);
      try {
        const resolved = best.map((s: any) => s);
        logger.info('Collector: selected path (resolved):');
        if (plannerInternals && typeof plannerInternals.logActionPath === 'function') {
          plannerInternals.logActionPath(resolved);
        } else {
          logger.info(JSON.stringify(resolved));
        }
      } catch (_) {}
      if (!connected) {
        running = false;
        return;
      }
      const sm = buildStateMachineForPath(bot, best, () => {
        running = false;
        safeChat('plan complete');
        // Advance to next target if present
        try {
          startNextTarget();
        } catch (_) {}
      });
      new BotStateMachine(bot, sm);
    });
    worker.on('error', (err: Error) => {
      logger.info(`Collector: worker error - ${err && err.message ? err.message : err}`);
      workerReady = false;
      // Don't set running = false here, let the message handler deal with it
    });
    worker.on('exit', (code: number) => {
      logDebug(`Collector: worker exited with code ${code}`);
      worker = null;
      workerReady = false;
      pending.clear();
      running = false;
    });
    logDebug('Collector: persistent planning worker created successfully');
    return worker;
  }

  // Cleanup on bot disconnect
  bot.on('end', () => {
    if (worker) {
      logDebug('Collector: terminating worker on bot disconnect');
      try {
        worker.terminate();
      } catch (_) {}
      worker = null;
      workerReady = false;
    }
  });

  function parseTargetsFromMessage(message: string): Target[] {
    const afterCmd = message.replace(/^\s*(collect|go)\s*/i, '');
    return afterCmd
      .split(',')
      .map((seg) => seg.trim())
      .filter(Boolean)
      .map((seg) => {
        const parts = seg.split(/\s+/).filter(Boolean);
        const item = parts[0];
        const count = Number.parseInt(parts[1]);
        return item && Number.isFinite(count) && count > 0 ? { item, count } : null;
      })
      .filter((t): t is Target => t !== null);
  }

  async function startNextTarget(): Promise<void> {
    if (running) {
      logDebug('Collector: startNextTarget called but already running');
      return;
    }
    if (!Array.isArray(sequenceTargets) || sequenceTargets.length === 0) {
      logDebug('Collector: no targets in sequence');
      return;
    }
    if (sequenceIndex >= sequenceTargets.length) {
      logInfo('Collector: all targets complete');
      safeChat('all targets complete');
      sequenceTargets = [];
      sequenceIndex = 0;
      return;
    }
    const target = sequenceTargets[sequenceIndex];
    sequenceIndex++;
    logInfo(
      `Collector: starting target ${sequenceIndex}/${sequenceTargets.length}: ${target.item} x${target.count}`
    );
    const version = bot.version || '1.20.1';
    const invObj = getInventoryObject(bot);

    // Build adaptive snapshot options
    const snapOpts: SnapshotOptions = { radii: RUNTIME.snapshotRadii };
    if (Number.isFinite(RUNTIME.snapshotYHalf)) {
      const y0 = Math.floor((bot.entity && bot.entity.position && bot.entity.position.y) || 64);
      snapOpts.yMin = y0 - RUNTIME.snapshotYHalf!;
      snapOpts.yMax = y0 + RUNTIME.snapshotYHalf!;
    }

    logDebug(`Collector: beginning adaptive snapshot with radii ${JSON.stringify(RUNTIME.snapshotRadii)}`);
    const tSnapStart = Date.now();

    // Validator: check if we can generate at least one path with this snapshot
    const pathValidator = async (snapshot: Snapshot): Promise<boolean> => {
      try {
        const mcData = minecraftData(version);
        const tree = planner(mcData, target.item, target.count, {
          inventory: invObj,
          log: false,
          pruneWithWorld: RUNTIME.pruneWithWorld,
          worldSnapshot: snapshot
        });

        if (!tree) {
          logDebug(`Collector: validator - no tree generated for radius ${snapshot.radius}`);
          return false;
        }

        // Try to generate at least one path
        const { enumerateActionPathsGenerator } = plannerInternals;
        const iter = enumerateActionPathsGenerator(tree, { inventory: invObj });
        for (const _path of iter) {
          logDebug(`Collector: validator - found valid path at radius ${snapshot.radius}`);
          return true; // Found at least one path
        }

        logDebug(`Collector: validator - no paths generated for radius ${snapshot.radius}`);
        return false;
      } catch (err: any) {
        logDebug(`Collector: validator error - ${err.message}`);
        return false;
      }
    };

    // Adaptive snapshot: tries each radius until validator passes
    const result: AdaptiveSnapshotResult = await captureAdaptiveSnapshot(bot, {
      ...snapOpts,
      validator: pathValidator,
      onProgress: (msg: string) => {
        logDebug(`Collector: ${msg}`);
      }
    });

    const snapshot = result.snapshot;
    const radiusUsed = result.radiusUsed;
    const attemptsCount = result.attemptsCount;

    try {
      setLastSnapshotRadius(radiusUsed);
    } catch (_) {}
    const dur = Date.now() - tSnapStart;
    logInfo(
      `Collector: snapshot captured in ${dur} ms (radius=${radiusUsed}, attempts=${attemptsCount}${
        Number.isFinite(snapOpts.yMin) ? `, yMin=${snapOpts.yMin}, yMax=${snapOpts.yMax}` : ''
      })`
    );

    // Log snapshot statistics
    if (snapshot && snapshot.blocks) {
      const blockTypes = Object.keys(snapshot.blocks).length;
      logDebug(`Collector: snapshot contains ${blockTypes} block types`);
    }
    if (snapshot && snapshot.entities) {
      const entityTypes = Object.keys(snapshot.entities).length;
      logDebug(`Collector: snapshot contains ${entityTypes} entity types`);
    }

    const id = `${Date.now()}_${Math.random()}`;
    logDebug(`Collector: creating planning job with id ${id}`);
    ensureWorker();
    pending.set(id, { snapshot, target });
    running = true;

    const planMessage: WorkerMessage = {
      type: 'plan',
      id,
      mcVersion: version,
      item: target.item,
      count: target.count,
      inventory: invObj,
      snapshot,
      perGenerator: RUNTIME.perGenerator,
      pruneWithWorld: RUNTIME.pruneWithWorld,
      telemetry: (RUNTIME as any).botLogLevel === 'verbose'
    };
    logDebug(`Collector: posting planning message to worker`);
    logDebug(`Collector: inventory contains ${Object.keys(invObj).length} item types`);
    worker!.postMessage(planMessage);
  }

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
      sequenceTargets = lastSequence.slice();
      sequenceIndex = 0;
      if (running) {
        safeChat('already running, please wait');
        return;
      }
      startNextTarget().catch(() => {});
      return;
    }

    const parsed = parseTargetsFromMessage(message);
    if (!parsed || parsed.length === 0) {
      safeChat('usage: collect <item> <count>[, <item> <count> ...]');
      return;
    }
    lastSequence = parsed.slice();
    sequenceTargets = parsed.slice();
    sequenceIndex = 0;
    if (running) {
      safeChat('already running, please wait');
      return;
    }
    startNextTarget().catch(() => {});
  });
});

