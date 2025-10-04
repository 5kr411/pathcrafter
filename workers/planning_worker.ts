import { parentPort, Worker } from 'worker_threads';
import * as path from 'path';
import { ActionPath } from '../action_tree/types';
import { PlanMessage } from './types';
import { getPlanningTelemetryEnabled, setPlanningTelemetryEnabled } from '../utils/config';
import { dedupePaths } from '../path_generators/generateTopN';
import { computePathWeight } from '../utils/pathUtils';
import { hoistMiningInPaths } from '../path_optimizations/hoistMining';
import { computePathResourceDemand } from '../path_filters/worldResources';
import { WorkerPool } from '../utils/workerPool';
import plan, { _internals } from '../planner';
import logger from '../utils/logger';

/**
 * Worker thread for planning item acquisition
 * 
 * This worker handles the full planning pipeline:
 * 1. Build recipe tree
 * 2. Enumerate paths using multiple strategies (via enumerator workers)
 * 3. Deduplicate and rank paths
 * 4. Return the best paths
 */

if (!parentPort) {
  throw new Error('This module must be run as a worker thread');
}

// Create a persistent worker pool for enumerators
const workerPath = path.resolve(__dirname, './enumerator_worker.js');
const enumeratorPool = new WorkerPool(workerPath, 3);

// Initialize pool on first use
let poolInitialized = false;

parentPort.on('message', async (msg: PlanMessage) => {
  logger.debug(`PlanningWorker: received message type=${msg?.type}`);
  
  if (!msg || msg.type !== 'plan') {
    logger.debug(`PlanningWorker: ignoring non-plan message`);
    return;
  }

  const { id, mcVersion, item, count, inventory, snapshot, perGenerator, pruneWithWorld, telemetry } = msg;
  
  logger.debug(`PlanningWorker: starting plan for ${item} x${count} (id=${id})`);
  logger.debug(`PlanningWorker: mcVersion=${mcVersion}, perGenerator=${perGenerator}, pruneWithWorld=${pruneWithWorld}, telemetry=${telemetry}`);

  try {
    if (typeof telemetry !== 'undefined') {
      setPlanningTelemetryEnabled(!!telemetry);
      logger.debug(`PlanningWorker: telemetry enabled=${!!telemetry}`);
    }

    const t0 = Date.now();
    logger.debug(`PlanningWorker: resolving minecraft data for ${mcVersion || '1.20.1'}`);
    const mcData = _internals.resolveMcData(mcVersion || '1.20.1');
    logger.debug(`PlanningWorker: building recipe tree`);
    const tBuildStart = Date.now();
    const tree = plan(mcData, item, count, {
      inventory,
      log: false,
      pruneWithWorld: !!pruneWithWorld,
      worldSnapshot: snapshot
    });
    const tBuildMs = Date.now() - tBuildStart;

    logger.debug(`PlanningWorker: built tree in ${tBuildMs} ms for ${item} x${count}`);
    
    if (!tree) {
      logger.error(`PlanningWorker: tree is null or undefined!`);
      throw new Error('Failed to build recipe tree');
    }
    
    logger.debug(`PlanningWorker: tree action=${tree.action}, operator=${tree.operator}`);

    // Initialize pool on first use
    if (!poolInitialized) {
      logger.debug(`PlanningWorker: initializing enumerator pool`);
      await enumeratorPool.init();
      poolInitialized = true;
      const stats = enumeratorPool.getStats();
      logger.debug(`PlanningWorker: pool initialized (${stats.total} workers)`);
    }

    const limit = Number.isFinite(perGenerator) ? perGenerator : 200;
    logger.debug(`PlanningWorker: using enumerator pool, limit=${limit}`);

    /**
     * Runs path enumeration using a worker from the pool
     */
    function runEnum(gen: 'action' | 'shortest' | 'lowest'): Promise<ActionPath[]> {
      return enumeratorPool.execute<ActionPath[]>((w: Worker) => {
        return new Promise((resolve) => {
          const started = Date.now();
          logger.debug(`PlanningWorker: acquired worker for ${gen} enumeration`);

          const timeout = setTimeout(() => {
            logger.error(`PlanningWorker: ${gen} enumeration timeout after 30s`);
            resolve([]);
          }, 30000); // 30 second timeout

          const messageHandler = (msg: any) => {
            clearTimeout(timeout);
            logger.debug(`PlanningWorker: ${gen} worker message received, type=${msg?.type}, ok=${msg?.ok}`);

            const ok = msg && msg.type === 'result' && msg.ok === true;
            const paths = ok && Array.isArray(msg.paths) ? msg.paths : [];
            const dt = Date.now() - started;

            if (getPlanningTelemetryEnabled()) {
              logger.debug(`PlanningWorker: enum[${gen}] finished in ${dt} ms (${paths.length} paths)`);
            }

            w.removeListener('message', messageHandler);
            w.removeListener('error', errorHandler);
            resolve(paths);
          };

          const errorHandler = (err: Error) => {
            clearTimeout(timeout);
            logger.error(`PlanningWorker: ${gen} worker error - ${err && err.message ? err.message : err}`);
            w.removeListener('message', messageHandler);
            w.removeListener('error', errorHandler);
            resolve([]);
          };

          w.once('message', messageHandler);
          w.once('error', errorHandler);

          w.postMessage({ type: 'enumerate', generator: gen, tree, inventory, limit });
          logger.debug(`PlanningWorker: ${gen} message posted to pooled worker`);
        });
      });
    }

    // Run all three enumeration strategies in parallel
    const tEnumStart = Date.now();
    logger.debug(`PlanningWorker: starting parallel enumeration`);
    const [a, s, l] = await Promise.all([
      runEnum('action'),
      runEnum('shortest'),
      runEnum('lowest')
    ]);
    const tEnumMs = Date.now() - tEnumStart;

    logger.debug(
      `PlanningWorker: enumerated paths in ${tEnumMs} ms (action=${a.length}, shortest=${s.length}, lowest=${l.length})`
    );

    const tFilterStart = Date.now();
    const merged = dedupePaths(([] as ActionPath[]).concat(a, s, l));

    // Tie-break equal weight paths using average distance score if snapshot provided
    if (snapshot && snapshot.blocks && typeof snapshot.blocks === 'object') {
      /**
       * Computes a distance score for a path based on resource locations
       */
      function distScore(path: ActionPath): number {
        try {
          const demand = computePathResourceDemand(path);
          let total = 0;
          let cnt = 0;

          if (demand && demand.blocks && demand.blocks.forEach && snapshot && snapshot.blocks) {
            demand.blocks.forEach((need, name) => {
              const rec = snapshot.blocks![name];
              const avg = rec && Number.isFinite(rec.averageDistance) ? rec.averageDistance : null;
              if (avg != null) {
                total += avg * Math.max(1, need || 1);
                cnt += Math.max(1, need || 1);
              }
            });
          }

          return cnt > 0 ? total / cnt : Number.POSITIVE_INFINITY;
        } catch (_) {
          return Number.POSITIVE_INFINITY;
        }
      }

      merged.sort((x, y) => {
        const wx = computePathWeight(x);
        const wy = computePathWeight(y);
        if (wx !== wy) return wx - wy;
        return distScore(x) - distScore(y);
      });
    } else {
      merged.sort((x, y) => computePathWeight(x) - computePathWeight(y));
    }

    const ranked = hoistMiningInPaths(merged);
    const tFilterMs = Date.now() - tFilterStart;

    if (getPlanningTelemetryEnabled()) {
      logger.debug(`PlanningWorker: filtered candidates in ${tFilterMs} ms; ${merged.length} total candidates`);
    }

    // Log the final path if telemetry is enabled
    try {
      const top = ranked && ranked[0];
      if (getPlanningTelemetryEnabled()) {
        if (top && _internals && typeof _internals.logActionPath === 'function') {
          logger.debug('PlanningWorker: final path:');
          _internals.logActionPath(top);
        }
      }
    } catch (_) {
      // Ignore logging errors
    }

    if (getPlanningTelemetryEnabled()) {
      logger.debug(`PlanningWorker: end-to-end planning took ${Date.now() - t0} ms`);
    }

    logger.debug(`PlanningWorker: sending result to parent (${ranked.length} paths)`);
    parentPort!.postMessage({ type: 'result', id, ok: true, ranked });
  } catch (err) {
    const errorMsg = (err && (err as Error).stack) ? (err as Error).stack : String(err);
    logger.error(`PlanningWorker: ERROR - ${errorMsg}`);
    parentPort!.postMessage({ type: 'result', id, ok: false, error: errorMsg });
  }
});

