import { ActionPath, ActionStep } from '../action_tree/types';

/**
 * Path weight computation utilities
 * 
 * Weight heuristics:
 * - craft (inventory): 1 per count
 * - craft (table): 10 per count
 * - smelt: 100 per count
 * - mine: 1000 per count
 * - hunt: 10000 per count
 */

/**
 * Computes the weight of a single action step
 * 
 * @param step - Action step to weigh
 * @returns Weight value
 */
export function stepWeight(step: ActionStep | null | undefined): number {
  if (!step || !step.action) return 0;

  const count = Number(step.count) || 0;
  if (count <= 0) return 0;

  if (step.action === 'craft') {
    return (step.what === 'inventory' ? 1 : 10) * count;
  }

  if (step.action === 'smelt') return 100 * count;
  if (step.action === 'mine') return 1000 * count;
  if (step.action === 'hunt') return 10000 * count;

  return 0;
}

/**
 * Computes the total weight of an action path
 * 
 * Lower weight is better (simpler/faster to execute)
 * 
 * @param path - Action path to weigh
 * @returns Total weight
 * 
 * @example
 * computePathWeight([
 *   { action: 'mine', what: 'oak_log', count: 4 },
 *   { action: 'craft', what: 'inventory', count: 1 }
 * ]) // returns 4001 (4*1000 + 1*1)
 */
export function computePathWeight(path: ActionPath): number {
  if (!Array.isArray(path)) return 0;

  let total = 0;
  for (const step of path) {
    if (!step || !step.action) continue;

    const count = Number(step.count) || 0;
    if (count <= 0) continue;

    if (step.action === 'craft') {
      total += (step.what === 'inventory' ? 1 : 10) * count;
    } else if (step.action === 'smelt') {
      total += 100 * count;
    } else if (step.action === 'mine') {
      total += 1000 * count;
    } else if (step.action === 'hunt') {
      total += 10000 * count;
    }
  }

  return total;
}

