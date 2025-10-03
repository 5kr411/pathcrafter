import { parentPort, Worker } from 'worker_threads';
import * as path from 'path';
import { ActionPath } from '../action_tree/types';
import { PlanMessage } from './types';
import { getPlanningTelemetryEnabled, setPlanningTelemetryEnabled } from '../utils/config';
import { dedupePaths } from '../path_generators/generateTopN';
import { computePathWeight } from '../utils/pathUtils';
import { hoistMiningInPaths } from '../path_optimizations/hoistMining';
import { computePathResourceDemand } from '../path_filters/worldResources';

const planner = require('../planner');
const logger = require('../utils/logger');

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

parentPort.on('message', async (msg: PlanMessage) => {
  if (!msg || msg.type !== 'plan') return;

  const { id, mcVersion, item, count, inventory, snapshot, perGenerator, pruneWithWorld, telemetry } = msg;

  try {
    if (typeof telemetry !== 'undefined') {
      setPlanningTelemetryEnabled(!!telemetry);
    }

    const t0 = Date.now();
    const mcData = planner._internals.resolveMcData(mcVersion || '1.20.1');
    const tBuildStart = Date.now();
    const tree = planner(mcData, item, count, {
      inventory,
      log: false,
      pruneWithWorld: !!pruneWithWorld,
      worldSnapshot: snapshot
    });
    const tBuildMs = Date.now() - tBuildStart;

    if (getPlanningTelemetryEnabled()) {
      logger.info(`PlanningWorker: built tree in ${tBuildMs} ms for ${item} x${count}`);
    }

    const limit = Number.isFinite(perGenerator) ? perGenerator : 200;
    const workerPath = path.resolve(__dirname, './enumerator_worker.js');

    /**
     * Runs path enumeration in a separate worker thread
     */
    function runEnum(gen: 'action' | 'shortest' | 'lowest'): Promise<ActionPath[]> {
      return new Promise((resolve) => {
        const started = Date.now();
        try {
          const w = new Worker(workerPath);

          w.once('message', (msg: any) => {
            try {
              w.terminate();
            } catch (_) {
              // Ignore termination errors
            }

            const ok = msg && msg.type === 'result' && msg.ok === true;
            const paths = ok && Array.isArray(msg.paths) ? msg.paths : [];
            const dt = Date.now() - started;

            if (getPlanningTelemetryEnabled()) {
              logger.info(`PlanningWorker: enum[${gen}] finished in ${dt} ms (${paths.length} paths)`);
            }

            resolve(paths);
          });

          w.once('error', () => {
            try {
              w.terminate();
            } catch (_) {
              // Ignore termination errors
            }
            resolve([]);
          });

          w.postMessage({ type: 'enumerate', generator: gen, tree, inventory, limit });
        } catch (_) {
          resolve([]);
        }
      });
    }

    // Run all three enumeration strategies in parallel
    const tEnumStart = Date.now();
    const [a, s, l] = await Promise.all([
      runEnum('action'),
      runEnum('shortest'),
      runEnum('lowest')
    ]);
    const tEnumMs = Date.now() - tEnumStart;

    if (getPlanningTelemetryEnabled()) {
      logger.info(
        `PlanningWorker: enumerated paths in ${tEnumMs} ms (action=${a.length}, shortest=${s.length}, lowest=${l.length})`
      );
    }

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
      logger.info(`PlanningWorker: filtered candidates in ${tFilterMs} ms; ${merged.length} total candidates`);
    }

    // Log the final path if telemetry is enabled
    try {
      const top = ranked && ranked[0];
      if (getPlanningTelemetryEnabled()) {
        if (top && planner && planner._internals && typeof planner._internals.logActionPath === 'function') {
          logger.info('PlanningWorker: final path:');
          planner._internals.logActionPath(top);
        }
      }
    } catch (_) {
      // Ignore logging errors
    }

    if (getPlanningTelemetryEnabled()) {
      logger.info(`PlanningWorker: end-to-end planning took ${Date.now() - t0} ms`);
    }

    parentPort!.postMessage({ type: 'result', id, ok: true, ranked });
  } catch (err) {
    const errorMsg = (err && (err as Error).stack) ? (err as Error).stack : String(err);
    parentPort!.postMessage({ type: 'result', id, ok: false, error: errorMsg });
  }
});

