import { ActionPath, ActionStep } from '../action_tree/types';

/**
 * Creates a unique key for a mining step to identify duplicates
 * @param step - The mining step to create a key for
 * @returns JSON string representing the mining operation
 */
function makeMiningKey(step: ActionStep): string {
  const what = step && step.what ? JSON.stringify(step.what) : null;
  const target = step && 'targetItem' in step ? JSON.stringify((step as any).targetItem) : null;
  const tool = step && 'tool' in step ? JSON.stringify((step as any).tool) : null;
  return JSON.stringify({ what, target, tool });
}

/**
 * Optimizes a single path by hoisting and merging duplicate mining operations
 * 
 * When a path contains multiple mining steps for the same block with the same tool,
 * this function:
 * 1. Identifies all duplicate mining operations
 * 2. Keeps only the first occurrence
 * 3. Sums up the counts from all occurrences into the first one
 * 
 * This optimization reduces redundant actions and makes paths more efficient.
 * 
 * @param path - The action path to optimize
 * @returns Optimized path with merged mining steps
 * 
 * @example
 * // Input: [mine oak_log x2, craft planks, mine oak_log x3]
 * // Output: [mine oak_log x5, craft planks]
 */
export function hoistMiningInPath(path: ActionPath): ActionPath {
  if (!Array.isArray(path)) return path;

  const firstIndexByKey = new Map<string, number>();
  const totalCountByKey = new Map<string, number>();
  const indicesToRemove = new Set<number>();

  // First pass: identify all mining steps and track their positions
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (!step || step.action !== 'mine') continue;

    const key = makeMiningKey(step);
    const count = Number(step.count) || 1;

    if (!firstIndexByKey.has(key)) {
      // First occurrence of this mining operation
      firstIndexByKey.set(key, i);
      totalCountByKey.set(key, count);
    } else {
      // Duplicate: add to total count and mark for removal
      totalCountByKey.set(key, (totalCountByKey.get(key) || 0) + count);
      indicesToRemove.add(i);
    }
  }

  // If no duplicates found, return original path
  if (indicesToRemove.size === 0) return path;

  // Second pass: build optimized path
  const optimized: ActionPath = [];
  for (let i = 0; i < path.length; i++) {
    if (indicesToRemove.has(i)) continue;

    const step = path[i];
    if (step && step.action === 'mine') {
      const key = makeMiningKey(step);
      const firstIdx = firstIndexByKey.get(key);

      // If this is the first occurrence and there were duplicates, update the count
      if (firstIdx === i) {
        const total = totalCountByKey.get(key) || (Number(step.count) || 1);
        if ((Number(step.count) || 1) !== total) {
          optimized.push({ ...step, count: total });
          continue;
        }
      }
    }
    optimized.push(step);
  }

  return optimized;
}

/**
 * Optimizes multiple paths by hoisting and merging duplicate mining operations
 * 
 * Applies the hoistMiningInPath optimization to each path in the array.
 * 
 * @param paths - Array of action paths to optimize
 * @returns Array of optimized paths
 */
export function hoistMiningInPaths(paths: ActionPath[]): ActionPath[] {
  if (!Array.isArray(paths)) return paths;
  return paths.map(p => hoistMiningInPath(p));
}

