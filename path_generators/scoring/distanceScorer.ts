import { ActionPath } from '../../action_tree/types';
import { WorldSnapshot } from '../types';

/**
 * Calculates a distance score for a path based on world snapshot
 * 
 * This function is variant-aware: it checks all variants for mining steps
 * and uses the closest variant's distance.
 * 
 * @param path - The action path to score
 * @param snapshot - World snapshot containing block/entity distances
 * @returns Distance score (lower is better, Infinity if blocks not found)
 */
export function calculateDistanceScore(path: ActionPath, snapshot: WorldSnapshot | null): number {
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

