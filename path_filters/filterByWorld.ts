import { ActionPath } from '../action_tree/types';
import { WorldSnapshot, FilterOptions } from './types';
import { filterPathVariantsByWorld } from './filterVariants';

/**
 * Filters paths based on world resource availability
 * 
 * Given a set of paths and a world snapshot, this function:
 * 1. Filters variant lists to only include available resources
 * 
 * Path validity is ensured at the tree level, so no additional validation is needed.
 * 
 * @param paths - Array of action paths to filter
 * @param snapshot - World snapshot containing resource availability
 * @param options - Additional filtering options (unused)
 * @returns Filtered array containing only feasible paths
 * 
 * @example
 * // If world has only oak_log and spruce_log (but not birch_log)
 * // Step with variants [oak_log, spruce_log, birch_log] becomes [oak_log, spruce_log]
 */
export function filterPathsByWorldSnapshot(
  paths: ActionPath[],
  snapshot: WorldSnapshot | null | undefined,
  _options: FilterOptions = {}
): ActionPath[] {
  // Filter variants to only include available resources
  // Tree ensures validity, so no additional validation needed
  return filterPathVariantsByWorld(paths, snapshot);
}

