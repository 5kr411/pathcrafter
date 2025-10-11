import * as path from 'path';
import { Worker } from 'worker_threads';
import { ActionPath, TreeNode } from '../action_tree/types';
import { EnumeratorJob, WorkerMessage } from './types';

/**
 * Executes path generation in parallel using worker threads
 * 
 * Spawns workers for three generator strategies:
 * - action: Basic enumeration
 * - shortest: Prioritizes shorter paths
 * - lowest: Prioritizes lower-weight paths
 * 
 * @param tree - Recipe tree to enumerate paths from
 * @param inventoryRecord - Inventory as plain object (for worker serialization)
 * @param perGenerator - Number of paths to generate per strategy
 * @returns Promise resolving to array of path arrays (one per generator)
 */
export async function executeGeneratorsInWorkers(
  tree: TreeNode,
  inventoryRecord: Record<string, number> | undefined,
  perGenerator: number
): Promise<ActionPath[][]> {
  const workerPath = __dirname.includes('/dist/')
    ? path.resolve(__dirname, '../workers/enumerator_worker.js')
    : path.resolve(__dirname, '../dist/workers/enumerator_worker.js');

  const jobs: EnumeratorJob[] = [
    { generator: 'action', tree, inventory: inventoryRecord, limit: perGenerator },
    { generator: 'shortest', tree, inventory: inventoryRecord, limit: perGenerator },
    { generator: 'lowest', tree, inventory: inventoryRecord, limit: perGenerator }
  ];

  const batches = await Promise.all(
    jobs.map(
      job =>
        new Promise<ActionPath[]>(resolve => {
          try {
            const w = new Worker(workerPath);

            w.once('message', (msg: WorkerMessage) => {
              try {
                w.terminate();
              } catch (_) {
                // Ignore termination errors
              }
              if (!msg || msg.type !== 'result' || msg.ok !== true) {
                return resolve([]);
              }
              resolve(Array.isArray(msg.paths) ? msg.paths : []);
            });

            w.once('error', () => {
              try {
                w.terminate();
              } catch (_) {
                // Ignore termination errors
              }
              resolve([]);
            });

            w.postMessage({ type: 'enumerate', ...job });
          } catch (_) {
            resolve([]);
          }
        })
    )
  );

  return batches;
}

