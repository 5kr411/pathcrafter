import { getPersistentWorkstations } from './persistentItemsConfig';
import { computePathWeight } from './pathUtils';
import { ActionPath } from '../action_tree/types';
import logger from './logger';

// Per-workstation cost cache. A present entry means computation has run:
// `number` is a valid cost, `null` means no crafting path was found.
let cache: Map<string, number | null> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
let cachedCtx: any = null;
const workstationSet = new Set(getPersistentWorkstations());

// Workstations currently mid-computation. Queries for these return undefined
// so that a `mine X` step weight inside X's own cost computation falls back
// to the default (1000 * count) instead of recursing into another compute.
const computing = new Set<string>();

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
function computeWorkstationCost(ctx: any, workstation: string): number | null {
  // Lazy-require to avoid circular deps at module load time
  const { plan } = require('../planner');
  const { enumerateLowestWeightPathsGenerator } = require('../path_generators/lowestWeightPathsGenerator');

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
      if (isDirectMinePath(path, workstation)) continue;
      const weight = computePathWeight(path);
      if (weight > 0) {
        logger.debug(`WorkstationCostCache: ${workstation} = ${weight}`);
        return weight;
      }
    }
  } catch (err) {
    logger.debug(`WorkstationCostCache: failed to compute cost for ${workstation}: ${err}`);
  }
  return null;
}

/**
 * Initializes the workstation cost cache.
 *
 * Behavior depends on whether a subset is supplied:
 * - Without a subset (production call from planning_worker): stashes the planner
 *   context and marks the cache ready, but defers all computation. Each
 *   workstation's cost is computed on first query via getWorkstationCraftCost.
 *   This avoids a multi-minute upfront cost that was dominating first-plan latency.
 * - With a subset (tests / callers that want deterministic eager init): eagerly
 *   computes the listed workstations' costs upfront. Callers can still query
 *   other workstations later; those will fall through to lazy computation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
export function initWorkstationCostCache(ctx: any, workstationSubset?: readonly string[]): void {
  cache = new Map<string, number | null>();
  cachedCtx = ctx;

  if (workstationSubset && workstationSubset.length > 0) {
    // Route through the lazy entrypoint so the in-progress guard applies —
    // this prevents infinite recursion if a workstation's cost computation
    // references its own mine step inside the path evaluation.
    for (const workstation of workstationSubset) {
      getWorkstationCraftCost(workstation);
    }
    logger.info(`WorkstationCostCache: eagerly initialized ${cache.size} workstation costs`);
  } else {
    logger.info('WorkstationCostCache: ready (lazy mode — costs computed on first query)');
  }
}

/**
 * Returns the cached craft-from-scratch cost for a workstation block,
 * computing it on demand if not yet cached.
 *
 * Returns undefined if the cache is not initialized, the block is not a
 * known workstation, or no crafting path was found.
 */
export function getWorkstationCraftCost(blockName: string): number | undefined {
  if (!cache) return undefined;
  if (cache.has(blockName)) {
    const v = cache.get(blockName);
    return v === null ? undefined : v;
  }
  if (!workstationSet.has(blockName)) return undefined;
  if (computing.has(blockName)) return undefined;

  computing.add(blockName);
  try {
    const cost = computeWorkstationCost(cachedCtx, blockName);
    cache.set(blockName, cost);
    return cost === null ? undefined : cost;
  } finally {
    computing.delete(blockName);
  }
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
  cachedCtx = null;
  computing.clear();
}
