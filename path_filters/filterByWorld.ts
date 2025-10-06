import { ActionPath } from '../action_tree/types';
import { WorldSnapshot, FilterOptions } from './types';
import { buildWorldAvailability, computePathResourceDemand, isDemandSatisfiedByAvailability } from './worldResources';
import { filterPathVariantsByWorld } from './filterVariants';
import { simulatePath } from '../utils/pathValidation';
import { getSmeltsPerUnitForFuel } from '../utils/smeltingConfig';

/**
 * Filters paths based on world resource availability
 * 
 * Given a set of paths and a world snapshot, this function:
 * 1. Filters variant lists to only include available resources
 * 2. Builds availability from the snapshot
 * 3. Computes resource demand for each path
 * 4. Keeps only paths that can be satisfied by available resources
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
 * // If world has only oak_log and spruce_log (but not birch_log)
 * // Step with variants [oak_log, spruce_log, birch_log] becomes [oak_log, spruce_log]
 * // If world has only 5 oak_logs, path requiring 10 oak_logs will be filtered out
 */
export function filterPathsByWorldSnapshot(
  paths: ActionPath[],
  snapshot: WorldSnapshot | null | undefined,
  options: FilterOptions = {}
): ActionPath[] {
  // First, filter variants to only include available resources
  const variantFilteredPaths = filterPathVariantsByWorld(paths, snapshot);
  
  // Then check if resource demands can be satisfied
  const availability = buildWorldAvailability(snapshot);
  const results: ActionPath[] = [];

  for (const path of variantFilteredPaths) {
    const demand = computePathResourceDemand(path);
    if (!isDemandSatisfiedByAvailability(demand, availability, options)) {
      continue;
    }

    // Also validate the path can be executed (all craft/smelt steps have required ingredients)
    // Start with only the initial inventory, mining/hunting will add resources during simulation
    const initialSupply = new Map<string, number>();
    
    if (options.inventory) {
      Object.entries(options.inventory).forEach(([name, count]) => {
        if (typeof count === 'number') {
          initialSupply.set(name, count);
        }
      });
    }

    // Simulate the path execution to ensure all steps can be executed
    const isValid = simulatePath(path, { 
      initialSupply, 
      requireStations: false, // Don't require stations as they can be crafted
      getSmeltsPerUnitForFuel // Provide fuel efficiency function
    });

    if (isValid) {
      results.push(path);
    }
  }

  return results;
}

