import * as path from 'path';
import { Worker } from 'worker_threads';
import { ActionPath, TreeNode } from '../action_tree/types';
import { EnumeratorJob, WorkerMessage } from './types';
import logger from '../utils/logger';
import { EnumResult, GeneratorName, extractPaths } from '../workers/planning_diagnostics';

/**
 * Executes path generation in parallel using worker threads and returns
 * per-generator envelopes that include failure diagnostics.
 *
 * Spawns workers for three generator strategies:
 * - action: Basic enumeration
 * - shortest: Prioritizes shorter paths
 * - lowest: Prioritizes lower-weight paths
 *
 * @param tree - Recipe tree to enumerate paths from
 * @param inventoryRecord - Inventory as plain object (for worker serialization)
 * @param perGenerator - Number of paths to generate per strategy
 * @returns Promise resolving to per-generator envelopes (paths + optional failure)
 */
export async function executeGeneratorsInWorkersWithDiagnostics(
  tree: TreeNode,
  inventoryRecord: Record<string, number> | undefined,
  perGenerator: number
): Promise<EnumResult[]> {
  const workerPath = __dirname.includes('/dist/')
    ? path.resolve(__dirname, '../workers/enumerator_worker.js')
    : path.resolve(__dirname, '../dist/workers/enumerator_worker.js');

  const jobs: Array<EnumeratorJob & { generator: GeneratorName }> = [
    { generator: 'action',   tree, inventory: inventoryRecord, limit: perGenerator },
    { generator: 'shortest', tree, inventory: inventoryRecord, limit: perGenerator },
    { generator: 'lowest',   tree, inventory: inventoryRecord, limit: perGenerator }
  ];

  return Promise.all(
    jobs.map(
      (job): Promise<EnumResult> =>
        new Promise<EnumResult>(resolve => {
          const started = Date.now();
          let w: Worker | null = null;
          let settled = false;

          const terminate = () => {
            if (!w) return;
            try {
              w.terminate();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
            } catch (err: any) {
              logger.debug(`workerOrchestrator: worker.terminate() failed: ${err?.message || err}`);
            }
          };

          const settle = (r: EnumResult) => {
            if (settled) return;
            settled = true;
            resolve(r);
          };

          try {
            w = new Worker(workerPath);

            w.once('message', (msg: WorkerMessage) => {
              terminate();
              const dt = Date.now() - started;
              if (!msg || msg.type !== 'result' || msg.ok !== true) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
                const detail = (msg as any)?.error ? String((msg as any).error) : 'worker returned non-ok result';
                logger.warn(`workerOrchestrator: ${job.generator} non-ok message after ${dt}ms: ${detail}`);
                settle({
                  generator: job.generator,
                  paths: [],
                  failure: { kind: 'error', message: detail, durationMs: dt }
                });
                return;
              }
              const paths = Array.isArray(msg.paths) ? msg.paths : [];
              settle({ generator: job.generator, paths });
            });

            w.once('error', (err: Error) => {
              terminate();
              const dt = Date.now() - started;
              const detail = err && err.message ? err.message : String(err);
              logger.warn(`workerOrchestrator: ${job.generator} worker error after ${dt}ms: ${detail}`);
              settle({
                generator: job.generator,
                paths: [],
                failure: { kind: 'error', message: detail, durationMs: dt }
              });
            });

            w.postMessage({ type: 'enumerate', ...job });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
          } catch (err: any) {
            const dt = Date.now() - started;
            const detail = err?.message || String(err);
            logger.warn(`workerOrchestrator: ${job.generator} failed to spawn worker: ${detail}`);
            settle({
              generator: job.generator,
              paths: [],
              failure: { kind: 'error', message: detail, durationMs: dt }
            });
          }
        })
    )
  );
}

/**
 * Legacy API: returns just the path arrays (one per generator).
 *
 * Callers that want failure diagnostics should use
 * `executeGeneratorsInWorkersWithDiagnostics`.
 */
export async function executeGeneratorsInWorkers(
  tree: TreeNode,
  inventoryRecord: Record<string, number> | undefined,
  perGenerator: number
): Promise<ActionPath[][]> {
  const results = await executeGeneratorsInWorkersWithDiagnostics(tree, inventoryRecord, perGenerator);
  return extractPaths(results);
}
