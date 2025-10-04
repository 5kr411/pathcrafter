import * as path from 'path';
import { Worker } from 'worker_threads';
import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions, EnumeratorJob, WorkerMessage } from './types';

import { _internals as plannerInternals } from '../planner';
import { computePathWeight } from '../utils/pathUtils';
import { computePathResourceDemand } from '../path_filters/worldResources';

/**
 * Takes the first N items from an iterator
 */
export function* takeN<T>(iter: Iterable<T>, n: number): Generator<T, void, unknown> {
  let i = 0;
  for (const v of iter) {
    yield v;
    i += 1;
    if (i >= n) break;
  }
}

/**
 * Serializes a path to a string for deduplication
 */
export function serializePath(path: ActionPath): string {
  try {
    return JSON.stringify(path);
  } catch (_) {
    return String(Math.random());
  }
}

/**
 * Removes duplicate paths from an array
 */
export function dedupePaths(paths: ActionPath[]): ActionPath[] {
  const seen = new Set<string>();
  const out: ActionPath[] = [];

  for (const p of paths) {
    const key = serializePath(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  return out;
}

/**
 * Generates top N paths from multiple generator strategies using worker threads
 * Falls back to synchronous generation if workers fail
 */
export async function generateTopNPathsFromGenerators(
  tree: TreeNode,
  options: GeneratorOptions,
  perGenerator: number
): Promise<ActionPath[]> {
  const inventory = options && options.inventory ? options.inventory : undefined;
  const snapshot = options && options.worldSnapshot ? options.worldSnapshot : null;

  // Determine worker path - use dist for compiled code, or find it relative to source
  const workerPath = __dirname.includes('/dist/') 
    ? path.resolve(__dirname, '../workers/enumerator_worker.js')
    : path.resolve(__dirname, '../dist/workers/enumerator_worker.js');
  const jobs: EnumeratorJob[] = [
    { generator: 'action', tree, inventory, limit: perGenerator },
    { generator: 'shortest', tree, inventory, limit: perGenerator },
    { generator: 'lowest', tree, inventory, limit: perGenerator }
  ];

  let results: ActionPath[][] = [];

  try {
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
    results = batches;
  } catch (_) {
    // Fallback to synchronous generation
    try {
      const a: ActionPath[] = [];
      const iterA = plannerInternals.enumerateActionPathsGenerator(tree, { inventory });
      for (const p of takeN(iterA, perGenerator)) {
        a.push(p as ActionPath);
      }

      const b: ActionPath[] = [];
      const iterS = plannerInternals.enumerateShortestPathsGenerator(tree, { inventory });
      for (const p of takeN(iterS, perGenerator)) {
        b.push(p as ActionPath);
      }

      const c: ActionPath[] = [];
      const iterL = plannerInternals.enumerateLowestWeightPathsGenerator(tree, { inventory });
      for (const p of takeN(iterL, perGenerator)) {
        c.push(p as ActionPath);
      }

      results = [a, b, c];
    } catch (_) {
      results = [[], [], []];
    }
  }

  const all = ([] as ActionPath[]).concat(...results);
  const unique = dedupePaths(all);

  /**
   * Calculates a distance score for a path based on world snapshot
   */
  function distanceScore(path: ActionPath): number {
    try {
      if (!snapshot || !snapshot.blocks || typeof snapshot.blocks !== 'object') {
        return Number.POSITIVE_INFINITY;
      }

      const demand = computePathResourceDemand(path);
      let totalWeighted = 0;
      let totalCount = 0;

      if (demand && demand.blocks && demand.blocks.forEach) {
        demand.blocks.forEach((count: number, name: string) => {
          const rec = snapshot.blocks![name];
          const avg = rec && Number.isFinite(rec.averageDistance) ? rec.averageDistance : null;

          if (avg != null) {
            totalWeighted += avg * Math.max(1, count || 1);
            totalCount += Math.max(1, count || 1);
          }
        });
      }

      if (totalCount === 0) {
        return Number.POSITIVE_INFINITY;
      }

      return totalWeighted / totalCount;
    } catch (_) {
      return Number.POSITIVE_INFINITY;
    }
  }

  // Sort by weight first, then by distance score
  unique.sort((a, b) => {
    const wa = computePathWeight(a);
    const wb = computePathWeight(b);
    if (wa !== wb) return wa - wb;

    const da = distanceScore(a);
    const db = distanceScore(b);
    return da - db;
  });

  return unique;
}

