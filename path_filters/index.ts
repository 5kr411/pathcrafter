import { ActionPath, TreeNode } from '../action_tree/types';
import { GenerateAndFilterOptions } from './types';

// Re-export core filtering functions
export { 
  buildWorldAvailability, 
  computePathResourceDemand, 
  isDemandSatisfiedByAvailability,
  explainDemandShortfall
} from './worldResources';

export { filterPathsByWorldSnapshot } from './filterByWorld';

const { hoistMiningInPaths } = require('../../path_optimizations/hoistMining');
const { generateTopNPathsFromGenerators } = require('../../path_generators/generateTopN');
const plan = require('../../planner');
const { getPruneWithWorldEnabled, getDefaultPerGeneratorPaths } = require('../../utils/config');

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
  const mcData = plan._internals.resolveMcData(ctx);
  const pruneWithWorld = options.pruneWithWorld === true ? true : getPruneWithWorldEnabled();

  // Build recipe tree with all options
  const tree: TreeNode = plan(mcData, itemName, targetCount, {
    inventory: options.inventory,
    log: options.log,
    pruneWithWorld,
    worldSnapshot: snapshot,
    config: options && options.config ? options.config : undefined
  });

  // Generate top N paths from multiple strategies
  const candidates = await generateTopNPathsFromGenerators(
    tree,
    { ...options, worldSnapshot: snapshot },
    perGenerator
  );

  // Apply mining optimization
  return hoistMiningInPaths(candidates);
}

