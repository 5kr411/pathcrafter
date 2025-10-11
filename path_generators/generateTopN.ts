import * as path from 'path';
import { Worker } from 'worker_threads';
import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions, EnumeratorJob, WorkerMessage } from './types';

import { computePathWeight } from '../utils/pathUtils';
import { enumerateActionPathsGenerator } from './actionPathsGenerator';
import { enumerateShortestPathsGenerator } from './shortestPathsGenerator';
import { enumerateLowestWeightPathsGenerator } from './lowestWeightPathsGenerator';

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

  // Convert Map to Record for worker serialization (workers can't serialize Maps)
  const inventoryRecord = inventory instanceof Map 
    ? Object.fromEntries(inventory.entries())
    : undefined;

  // Determine worker path - use dist for compiled code, or find it relative to source
  const workerPath = __dirname.includes('/dist/') 
    ? path.resolve(__dirname, '../workers/enumerator_worker.js')
    : path.resolve(__dirname, '../dist/workers/enumerator_worker.js');
  const jobs: EnumeratorJob[] = [
    { generator: 'action', tree, inventory: inventoryRecord, limit: perGenerator },
    { generator: 'shortest', tree, inventory: inventoryRecord, limit: perGenerator },
    { generator: 'lowest', tree, inventory: inventoryRecord, limit: perGenerator }
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
      const iterA = enumerateActionPathsGenerator(tree, { inventory });
      for (const p of takeN(iterA, perGenerator)) {
        a.push(p as ActionPath);
      }

      const b: ActionPath[] = [];
      const iterS = enumerateShortestPathsGenerator(tree, { inventory });
      for (const p of takeN(iterS, perGenerator)) {
        b.push(p as ActionPath);
      }

      const c: ActionPath[] = [];
      const iterL = enumerateLowestWeightPathsGenerator(tree, { inventory });
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
   * Now variant-aware: checks whatVariants for mining steps
   */
  function distanceScore(path: ActionPath): number {
    if (!snapshot || !snapshot.blocks || typeof snapshot.blocks !== 'object') {
      return Number.POSITIVE_INFINITY;
    }

    let bestScore: number | null = null;
    let hasMineStep = false;

    for (const step of path) {
      if (step.action !== 'mine') continue;
      hasMineStep = true;

      let stepScore: number | null = null;

      for (const variant of step.what.variants) {
        const rec = snapshot.blocks![variant.value];
        if (!rec) continue;

        let distance: number | null = null;
        if (Number.isFinite(rec.closestDistance)) {
          distance = rec.closestDistance as number;
        } else if (Number.isFinite(rec.averageDistance)) {
          distance = rec.averageDistance as number;
        }

        if (distance == null) continue;

        stepScore = stepScore == null ? distance : Math.min(stepScore, distance);
      }

      if (stepScore == null) {
        return Number.POSITIVE_INFINITY;
      }

      bestScore = bestScore == null ? stepScore : Math.max(bestScore, stepScore);
    }

    if (!hasMineStep) {
      return 0;
    }

    return bestScore == null ? Number.POSITIVE_INFINITY : bestScore;
  }

  // Sort by weight first, then by distance score (fallback to Infinity)
  unique.sort((a, b) => {
    const wa = computePathWeight(a);
    const wb = computePathWeight(b);
    if (wa !== wb) return wa - wb;

    const da = distanceScore(a);
    const db = distanceScore(b);
    if (!Number.isFinite(da) && !Number.isFinite(db)) return 0;
    if (!Number.isFinite(da)) return 1;
    if (!Number.isFinite(db)) return -1;
    return da - db;
  });

  return unique;
}


