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
    try {
      if (!snapshot || !snapshot.blocks || typeof snapshot.blocks !== 'object') {
        return Number.POSITIVE_INFINITY;
      }

      let totalWeighted = 0;
      let totalCount = 0;

      // Check each step individually to handle variants
      for (const step of path) {
        if (step.action === 'mine') {
          const count = Math.max(1, step.count || 1);
          
          // Check if step has variants
          if (step.what.variants.length > 1) {
            // Find the best available variant (closest distance)
            let bestAvg: number | null = null;
            
            for (const variant of step.what.variants) {
              const rec = snapshot.blocks![variant.value];
              const avg = rec && Number.isFinite(rec.averageDistance) ? rec.averageDistance : null;
              
              if (avg != null && (bestAvg == null || avg < bestAvg)) {
                bestAvg = avg;
              }
            }
            
            // If at least one variant is available, use its distance
            if (bestAvg != null) {
              totalWeighted += bestAvg * count;
              totalCount += count;
            }
            // If no variants available, path gets infinite score (filtered out later)
          } else {
            // No variants - check the primary block
            const name = step.what.variants[0].value;
            const rec = snapshot.blocks![name];
            const avg = rec && Number.isFinite(rec.averageDistance) ? rec.averageDistance : null;
            
            if (avg != null) {
              totalWeighted += avg * count;
              totalCount += count;
            }
          }
        }
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

  // Filter out paths that require blocks not in the world (infinite distance score)
  // Only filter if we have a world snapshot
  if (snapshot && snapshot.blocks) {
    return unique.filter(path => {
      const score = distanceScore(path);
      return isFinite(score);
    });
  }

  return unique;
}

