import { ActionPath, ActionStep } from '../action_tree/types';
import { getWorkstationCraftCost, isKnownWorkstation } from './workstationCostCache';

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
    const whatValue = step.what.variants[0].value;
    return (whatValue === 'inventory' ? 1 : 10) * count;
  }

  if (step.action === 'smelt') return 100 * count;
  if (step.action === 'mine') {
    const variants = step.what?.variants;
    if (variants && variants.length > 0) {
      const blockName = variants[0].value;
      if (isKnownWorkstation(blockName)) {
        const craftCost = getWorkstationCraftCost(blockName);
        if (craftCost !== undefined) {
          return (craftCost + 1) * count;
        }
      }
    }
    return 1000 * count;
  }
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
    total += stepWeight(step);
  }

  return total;
}

