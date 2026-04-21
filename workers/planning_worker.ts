import { parentPort, Worker } from 'worker_threads';
import * as path from 'path';
import { ActionPath } from '../action_tree/types';
import { PlanMessage } from './types';
import { getPlanningTelemetryEnabled, setPlanningTelemetryEnabled } from '../utils/config';
import { dedupePaths } from '../path_generators/generateTopN';
import { computePathWeight } from '../utils/pathUtils';
import { hoistMiningInPaths } from '../path_optimizations/hoistMining';
import { dedupePersistentItemsInPaths } from '../path_optimizations/dedupePersistentItems';
import { removeOrphanedIngredientsInPaths } from '../path_optimizations/removeOrphans';
import { WorkerPool } from '../utils/workerPool';
import plan, { _internals } from '../planner';
import { initWorkstationCostCache, isWorkstationCacheReady } from '../utils/workstationCostCache';
import logger from '../utils/logger';
import { serializeTree } from '../action_tree/serialize';
import { EnumResult, collectGeneratorFailures } from './planning_diagnostics';

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

  const { id, mcVersion, item, count, inventory, snapshot, perGenerator, pruneWithWorld, combineSimilarNodes, telemetry } = msg;
  
  logger.debug(`PlanningWorker: starting plan for ${item} x${count} (id=${id})`);
  logger.debug(`PlanningWorker: mcVersion=${mcVersion}, perGenerator=${perGenerator}, pruneWithWorld=${pruneWithWorld}, telemetry=${telemetry}`);
  logger.debug(`PlanningWorker: snapshot radius=${snapshot?.radius}, has blocks=${!!snapshot?.blocks}`);
  logger.debug(`PlanningWorker: inventory items count=${Object.keys(inventory || {}).length}`);

  try {
    if (typeof telemetry !== 'undefined') {
      setPlanningTelemetryEnabled(!!telemetry);
      logger.debug(`PlanningWorker: telemetry enabled=${!!telemetry}`);
    }

    const t0 = Date.now();
    logger.debug(`PlanningWorker: resolving minecraft data for ${mcVersion || '1.20.1'}`);
    const mcData = _internals.resolveMcData(mcVersion || '1.20.1');

    // Populate the workstation cost cache once per worker. stepWeight() uses it
    // to penalize mining a persistent workstation (crafting_table, furnace, …)
    // above the craft-from-scratch cost — without this, mine paths beat craft
    // paths by a few points and bots on village-less maps loop forever looking
    // for a natural crafting_table to mine.
    if (!isWorkstationCacheReady()) {
      initWorkstationCostCache(mcData);
    }

    logger.debug(`PlanningWorker: building recipe tree`);
    const tBuildStart = Date.now();
    
    // Convert inventory from Record to Map (workers can't serialize Maps)
    const inventoryMap = inventory ? new Map(Object.entries(inventory)) : undefined;
    
    const tree = plan(mcData, item, count, {
      inventory: inventoryMap,
      log: false,
      pruneWithWorld: !!pruneWithWorld,
      combineSimilarNodes: combineSimilarNodes,
      worldSnapshot: snapshot
    });
    const tBuildMs = Date.now() - tBuildStart;

    logger.debug(`PlanningWorker: built tree in ${tBuildMs} ms for ${item} x${count}`);
    
    if (!tree) {
      logger.error(`PlanningWorker: tree is null or undefined!`);
      throw new Error('Failed to build recipe tree');
    }
    
    logger.debug(`PlanningWorker: tree action=${tree.action}, operator=${tree.operator}, children=${tree.children.variants.length}`);

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
    function runEnum(gen: 'action' | 'shortest' | 'lowest'): Promise<EnumResult> {
      return enumeratorPool.execute<EnumResult>((w: Worker) => {
        return new Promise((resolve) => {
          const started = Date.now();
          logger.debug(`PlanningWorker: acquired worker for ${gen} enumeration`);

          let settled = false;
          const settle = (r: EnumResult) => {
            if (settled) return;
            settled = true;
            w.removeListener('message', messageHandler);
            w.removeListener('error', errorHandler);
            resolve(r);
          };

          const timeout = setTimeout(() => {
            const dt = Date.now() - started;
            logger.warn(`PlanningWorker: ${gen} enumeration timeout after ${dt}ms`);
            settle({
              generator: gen,
              paths: [],
              failure: { kind: 'timeout', message: `${gen} enumeration exceeded 30s`, durationMs: dt }
            });
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

            if (!ok) {
              const detail = msg?.error ? String(msg.error) : 'worker returned non-ok result';
              logger.warn(`PlanningWorker: ${gen} worker returned failure after ${dt}ms: ${detail}`);
              settle({
                generator: gen,
                paths: [],
                failure: { kind: 'error', message: detail, durationMs: dt }
              });
              return;
            }

            settle({ generator: gen, paths });
          };

          const errorHandler = (err: Error) => {
            clearTimeout(timeout);
            const dt = Date.now() - started;
            const detail = err && err.message ? err.message : String(err);
            logger.warn(`PlanningWorker: ${gen} worker error after ${dt}ms: ${detail}`);
            settle({
              generator: gen,
              paths: [],
              failure: { kind: 'error', message: detail, durationMs: dt }
            });
          };

          w.once('message', messageHandler);
          w.once('error', errorHandler);

          const serializedTree = serializeTree(tree);
          w.postMessage({ type: 'enumerate', generator: gen, tree: serializedTree, inventory, limit });
          logger.debug(`PlanningWorker: ${gen} message posted to pooled worker`);
        });
      });
    }

    // Run all three enumeration strategies in parallel
    const tEnumStart = Date.now();
    logger.debug(`PlanningWorker: starting parallel enumeration`);
    const [aResult, sResult, lResult] = await Promise.all([
      runEnum('action'),
      runEnum('shortest'),
      runEnum('lowest')
    ]);
    const tEnumMs = Date.now() - tEnumStart;

    const a = aResult.paths;
    const s = sResult.paths;
    const l = lResult.paths;
    const generatorFailures = collectGeneratorFailures([aResult, sResult, lResult]);

    logger.debug(
      `PlanningWorker: enumerated paths in ${tEnumMs} ms (action=${a.length}, shortest=${s.length}, lowest=${l.length})`
    );
    if (generatorFailures.length > 0) {
      const failSummary = generatorFailures.map(f => `${f.generator}:${f.kind}`).join(', ');
      logger.warn(`PlanningWorker: ${generatorFailures.length}/3 enumerators failed | ${failSummary}`);
    }

    const tFilterStart = Date.now();
    const merged = dedupePaths(([] as ActionPath[]).concat(a, s, l));

    merged.sort((x, y) => computePathWeight(x) - computePathWeight(y));

    let ranked = hoistMiningInPaths(merged);
    ranked = dedupePersistentItemsInPaths(ranked, item);
    ranked = removeOrphanedIngredientsInPaths(ranked);
    const tFilterMs = Date.now() - tFilterStart;
    
    if (ranked.length > 0) {
      const firstPath = ranked[0];
      const topWeight = computePathWeight(firstPath);
      const topActions = firstPath.map((s: any) => s.action).join('→');
      const planMs = Date.now() - t0;
      let weightSummary = `w=${topWeight}`;
      if (ranked.length >= 2) {
        weightSummary += `, runner-up w=${computePathWeight(ranked[1])}`;
      }
      logger.info(
        `PlanningWorker: selected path for ${item} x${count} | ${firstPath.length} steps (${topActions}) | ${weightSummary} | ${ranked.length} candidates | ${planMs}ms`
      );
    } else {
      const planMs = Date.now() - t0;
      if (generatorFailures.length > 0) {
        const failSummary = generatorFailures.map(f => `${f.generator}:${f.kind}`).join(', ');
        logger.warn(
          `PlanningWorker: no viable paths for ${item} x${count} | ${merged.length} pre-filter | ` +
          `${generatorFailures.length}/3 enumerators failed (${failSummary}) | ${planMs}ms`
        );
      } else {
        logger.info(`PlanningWorker: no viable paths for ${item} x${count} | ${merged.length} pre-filter | ${planMs}ms`);
      }
    }

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
    } catch (err: any) {
      logger.debug(`PlanningWorker: telemetry path log failed: ${err?.message || err}`);
    }

    if (getPlanningTelemetryEnabled()) {
      logger.debug(`PlanningWorker: end-to-end planning took ${Date.now() - t0} ms`);
    }

    logger.debug(`PlanningWorker: sending result to parent (${ranked.length} paths, ${generatorFailures.length} generator failures)`);
    parentPort!.postMessage({ type: 'result', id, ok: true, ranked, generatorFailures });
  } catch (err) {
    const errorMsg = (err && (err as Error).stack) ? (err as Error).stack : String(err);
    logger.error(`PlanningWorker: ERROR - ${errorMsg}`);
    parentPort!.postMessage({ type: 'result', id, ok: false, error: errorMsg });
  }
});

