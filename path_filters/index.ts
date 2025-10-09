import { ActionPath, TreeNode } from '../action_tree/types';
import { GenerateAndFilterOptions } from './types';

// Re-export core filtering functions
export { 
  buildWorldAvailability, 
  isDemandSatisfiedByAvailability,
  explainDemandShortfall
} from './worldResources';

// Path validation removed - tree ensures validity
export { filterPathVariantsByWorld } from './filterVariants';

import { hoistMiningInPaths } from '../path_optimizations/hoistMining';
import { generateTopNPathsFromGenerators } from '../path_generators/generateTopN';
import { getPruneWithWorldEnabled, getDefaultPerGeneratorPaths } from '../utils/config';
import { plan, _internals as plannerInternals } from '../planner';

/**
 * Generates top N paths and filters them through optimizations
 * 
 * This is the main entry point for the path generation pipeline:
 * 1. Builds a recipe tree for the target item
 * 2. Generates paths from multiple strategies (action, shortest, lowest weight)
 * 3. Deduplicates and sorts by weight/distance
 * 4. Applies hoist mining optimization
 * 
 * @param ctx - Minecraft data context or version string
 * @param itemName - Name of the item to acquire
 * @param targetCount - Number of items needed
 * @param options - Generation and filtering options
 * @returns Promise resolving to array of optimized action paths
 * 
 * @example
 * const paths = await generateTopNAndFilter(mcData, 'iron_ingot', 5, {
 *   inventory: { oak_log: 10 },
 *   worldSnapshot: snapshot,
 *   perGenerator: 100
 * });
 */
export async function generateTopNAndFilter(
  ctx: any,
  itemName: string,
  targetCount: number,
  options: GenerateAndFilterOptions = {}
): Promise<ActionPath[]> {
  const perGenerator = Number.isFinite(options.perGenerator) 
    ? options.perGenerator! 
    : getDefaultPerGeneratorPaths();
  
  const snapshot = options.worldSnapshot;
  const mcData = plannerInternals.resolveMcData(ctx);
  const pruneWithWorld = options.pruneWithWorld === true ? true : getPruneWithWorldEnabled();

  // Build recipe tree with all options
  const tree: TreeNode = plan(mcData, itemName, targetCount, {
    inventory: options.inventory,
    log: options.log,
    pruneWithWorld,
    worldSnapshot: snapshot as any,
    combineSimilarNodes: options.combineSimilarNodes,
    config: options && options.config ? options.config : undefined
  });

  if (!tree) {
    return [];
  }

  // Generate top N paths from multiple strategies
  const candidates = await generateTopNPathsFromGenerators(
    tree,
    { ...options, worldSnapshot: snapshot },
    perGenerator
  );

  // Tree is already valid - no additional filtering needed
  const filtered = candidates;

  // Apply mining optimization
  return hoistMiningInPaths(filtered);
}

