import { ActionPath } from '../action_tree/types';
import { WorldSnapshot, FilterOptions } from './types';
import { buildWorldAvailability, computePathResourceDemand, isDemandSatisfiedByAvailability } from './worldResources';

/**
 * Filters paths based on world resource availability
 * 
 * Given a set of paths and a world snapshot, this function:
 * 1. Builds availability from the snapshot
 * 2. Computes resource demand for each path
 * 3. Keeps only paths that can be satisfied by available resources
 * 
 * This is crucial for ensuring the bot doesn't attempt paths that require
 * resources that don't exist in sufficient quantity in the world.
 * 
 * @param paths - Array of action paths to filter
 * @param snapshot - World snapshot containing resource availability
 * @param options - Additional filtering options
 * @returns Filtered array containing only feasible paths
 * 
 * @example
 * // If world has only 5 oak_logs
 * // Path requiring 10 oak_logs will be filtered out
 * // Path requiring 3 oak_logs will pass through
 */
export function filterPathsByWorldSnapshot(
  paths: ActionPath[],
  snapshot: WorldSnapshot | null | undefined,
  options: FilterOptions = {}
): ActionPath[] {
  const availability = buildWorldAvailability(snapshot);
  const results: ActionPath[] = [];

  for (const path of paths) {
    const demand = computePathResourceDemand(path);
    if (isDemandSatisfiedByAvailability(demand, availability, options)) {
      results.push(path);
    }
  }

  return results;
}

