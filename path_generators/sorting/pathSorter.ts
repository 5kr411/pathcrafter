import { ActionPath } from '../../action_tree/types';
import { computePathWeight } from '../../utils/pathUtils';
import { calculateDistanceScore } from '../scoring/distanceScorer';
import { WorldSnapshot } from '../types';

/**
 * Sorts paths by weight first, then by distance score as a tiebreaker
 * 
 * Lower weight is better (simpler/faster execution)
 * Lower distance is better (closer resources)
 * 
 * @param paths - Array of paths to sort
 * @param snapshot - Optional world snapshot for distance scoring
 * @returns Sorted array (modifies in place and returns)
 */
export function sortPathsByWeightAndDistance(
  paths: ActionPath[],
  snapshot: WorldSnapshot | null = null
): ActionPath[] {
  return paths.sort((a, b) => {
    const wa = computePathWeight(a);
    const wb = computePathWeight(b);
    if (wa !== wb) return wa - wb;

    const da = calculateDistanceScore(a, snapshot);
    const db = calculateDistanceScore(b, snapshot);
    if (!Number.isFinite(da) && !Number.isFinite(db)) return 0;
    if (!Number.isFinite(da)) return 1;
    if (!Number.isFinite(db)) return -1;
    return da - db;
  });
}

