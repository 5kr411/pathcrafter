import { getPersistentWorkstations } from './persistentItemsConfig';
import { computePathWeight } from './pathUtils';
import { ActionPath } from '../action_tree/types';
import logger from './logger';

// Module-level cache
let cache: Map<string, number> | null = null;
const workstationSet = new Set(getPersistentWorkstations());

/** Maximum paths to inspect per workstation when searching for a craft path */
const MAX_PATHS_PER_ITEM = 50;

/**
 * Returns true if a path is simply "mine the target item directly from the world"
 * rather than a genuine craft-from-scratch chain.
 */
function isDirectMinePath(path: ActionPath, targetItem: string): boolean {
  if (path.length !== 1) return false;
  const step = path[0];
  if (step.action !== 'mine') return false;
  const variant = step.what?.variants?.[0]?.value;
  return variant === targetItem;
}

/**
 * Computes the minimum craft-from-scratch cost for each workstation
 * by running the planner with empty inventory and no world budget,
 * then taking the lowest-weight path that actually crafts the item
 * (skipping paths that simply mine the workstation from the world).
 *
 * @param ctx - Planner context (version string, mcData instance, etc.)
 * @param workstationSubset - Optional subset of workstations to compute (defaults to all)
 */
export function initWorkstationCostCache(ctx: any, workstationSubset?: readonly string[]): void {
  // Lazy-require to avoid circular deps at module load time
  const { plan } = require('../planner');
  const { enumerateLowestWeightPathsGenerator } = require('../path_generators/lowestWeightPathsGenerator');

  cache = new Map<string, number>();

  const items = workstationSubset ?? getPersistentWorkstations();

  for (const workstation of items) {
    try {
      const tree = plan(ctx, workstation, 1, {
        inventory: new Map<string, number>(),
        log: false,
      });

      const gen = enumerateLowestWeightPathsGenerator(tree, {});
      let inspected = 0;

      for (const path of gen) {
        inspected++;
        if (inspected > MAX_PATHS_PER_ITEM) break;

        // Skip paths that just mine the workstation directly from the world
        if (isDirectMinePath(path, workstation)) continue;

        const weight = computePathWeight(path);
        if (weight > 0) {
          cache.set(workstation, weight);
          logger.debug(`WorkstationCostCache: ${workstation} = ${weight}`);
        }
        break;
      }
    } catch (err) {
      logger.debug(`WorkstationCostCache: failed to compute cost for ${workstation}: ${err}`);
    }
  }

  logger.info(`WorkstationCostCache: initialized ${cache.size} workstation costs`);
}

/**
 * Returns the cached craft-from-scratch cost for a workstation block,
 * or undefined if the block is not a workstation or has no craft path.
 */
export function getWorkstationCraftCost(blockName: string): number | undefined {
  if (!cache) return undefined;
  return cache.get(blockName);
}

/**
 * Returns whether a block name is a known workstation.
 */
export function isKnownWorkstation(blockName: string): boolean {
  return workstationSet.has(blockName);
}

/**
 * Returns whether the cache has been initialized.
 */
export function isWorkstationCacheReady(): boolean {
  return cache !== null;
}

/**
 * Clears the cache (for testing).
 */
export function clearWorkstationCostCache(): void {
  cache = null;
}
