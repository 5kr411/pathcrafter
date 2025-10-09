import { setLastMcData, setTargetItemNameGlobal } from './utils/context';
import { chooseMinimalToolName } from './utils/items';
import { renderName } from './utils/render';
import { computePathWeight } from './utils/pathUtils';
import { WorldBudget } from './utils/worldBudget';
import { WorldSnapshot } from './utils/worldSnapshotTypes';
import { RootNode, MinecraftData, VariantConstraintManager } from './action_tree/types';
import * as treeBuild from './action_tree/build';
import * as treeLogger from './action_tree/logger';
import * as treeEnumerate from './action_tree/enumerate';
import * as treeMetrics from './action_tree/metrics';

const actionPathsGenerator = require('./path_generators/actionPathsGenerator');
const shortestPathsGenerator = require('./path_generators/shortestPathsGenerator');
const lowestWeightPathsGenerator = require('./path_generators/lowestWeightPathsGenerator');

/**
 * Planning options for generating recipe trees
 */
export interface PlanOptions {
  /**
   * Current inventory items (item name -> count)
   */
  inventory?: Map<string, number>;

  /**
   * Whether to prune based on world availability
   */
  pruneWithWorld?: boolean;

  /**
   * World snapshot for pruning
   */
  worldSnapshot?: WorldSnapshot;

  /**
   * Whether to log the tree (default: true)
   */
  log?: boolean;

  /**
   * Whether to combine similar nodes (e.g., wood families) to reduce branching
   */
  combineSimilarNodes?: boolean;

  /**
   * Additional configuration options
   */
  config?: any;
}

/**
 * Context that can be passed to the planner
 * Can be:
 * - A minecraft version string (e.g., '1.19.2')
 * - A minecraft-data instance
 * - An object with a version property
 */
export type PlanContext = string | MinecraftData | { version: string } | any;

/**
 * Converts a world snapshot into a world budget for tree building
 * 
 * @param snap - World snapshot with block/entity statistics
 * @returns WorldBudget for resource tracking
 */
function buildWorldBudgetFromSnapshot(snap: WorldSnapshot): WorldBudget {
  const blocks: Record<string, number> = {};
  const blocksInfo: Record<string, { closestDistance: number }> = {};
  const entities: Record<string, number> = {};
  const entitiesInfo: Record<string, { closestDistance: number }> = {};

  // Calculate distance threshold from snapshot parameters
  const distanceThreshold = Number.isFinite(snap.radius)
    ? snap.radius!
    : Infinity;

  const allowedBlocksWithinThreshold = new Set<string>();

  // Process blocks
  if (snap.blocks && typeof snap.blocks === 'object' && !Array.isArray(snap.blocks)) {
    for (const name of Object.keys(snap.blocks)) {
      const rec = snap.blocks[name];
      const c = rec && rec.count !== null && rec.count !== undefined && Number.isFinite(rec.count) ? rec.count : 0;
      const d = rec && rec.closestDistance !== null && rec.closestDistance !== undefined && Number.isFinite(rec.closestDistance) ? rec.closestDistance : Infinity;
      blocksInfo[name] = { closestDistance: d };
      if (c > 0) blocks[name] = c;
      if (d <= distanceThreshold) allowedBlocksWithinThreshold.add(name);
    }
  }

  const allowedEntitiesWithinThreshold = new Set<string>();

  // Process entities
  if (snap.entities && typeof snap.entities === 'object' && !Array.isArray(snap.entities)) {
    for (const name of Object.keys(snap.entities)) {
      const rec = snap.entities[name];
      const c = rec && rec.count !== null && rec.count !== undefined && Number.isFinite(rec.count) ? rec.count : 0;
      const d = rec && rec.closestDistance !== null && rec.closestDistance !== undefined && Number.isFinite(rec.closestDistance) ? rec.closestDistance : Infinity;
      entitiesInfo[name] = { closestDistance: d };
      if (c > 0) entities[name] = c;
      if (d <= distanceThreshold) allowedEntitiesWithinThreshold.add(name);
    }
  }

  return {
    blocks,
    blocksInfo,
    entities,
    entitiesInfo,
    distanceThreshold,
    allowedBlocksWithinThreshold,
    allowedEntitiesWithinThreshold
  };
}

/**
 * Plans how to acquire a specific item in Minecraft
 * 
 * This is the main entry point for the planning system. It:
 * 1. Resolves minecraft data from various input formats
 * 2. Builds a recipe tree showing all ways to obtain the item
 * 3. Optionally prunes based on world availability
 * 4. Logs the tree (unless disabled)
 * 
 * @param ctx - Minecraft data context (version string, mcData instance, or object with version)
 * @param itemName - Name of the item to acquire (e.g., 'wooden_pickaxe')
 * @param targetCount - Number of items needed (default: 1)
 * @param options - Planning options (inventory, world pruning, logging)
 * @returns Recipe tree showing how to acquire the item
 * 
 * @example
 * ```typescript
 * const tree = plan('1.19.2', 'wooden_pickaxe', 1, {
 *   inventory: { oak_log: 5 },
 *   log: true
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // With world pruning
 * const snapshot = captureRawWorldSnapshot(bot);
 * const tree = plan(bot.mcData, 'iron_ingot', 3, {
 *   pruneWithWorld: true,
 *   worldSnapshot: snapshot
 * });
 * ```
 */
export function plan(
  ctx: PlanContext,
  itemName: string,
  targetCount: number = 1,
  options: PlanOptions = {}
): RootNode {
  
  const mc = treeBuild.resolveMcData(ctx);
  setLastMcData(mc || null);
  setTargetItemNameGlobal(itemName);

  // Optional world-pruning: derive world budget from snapshot summary
  let worldBudget: WorldBudget | undefined = undefined;
  try {
    if (options && options.pruneWithWorld === true && options.worldSnapshot && typeof options.worldSnapshot === 'object') {
      worldBudget = buildWorldBudgetFromSnapshot(options.worldSnapshot);
    }
  } catch (_) {
    // Ignore errors in building world budget
  }

  const inventoryMap = options?.inventory || new Map<string, number>();

  const tree = treeBuild.buildRecipeTree(ctx, itemName, targetCount, {
    inventory: inventoryMap,
    worldBudget,
    visited: new Set(),
    depth: 0,
    parentPath: [],
    config: {
      preferMinimalTools: true,
      avoidTool: options?.config?.avoidTool,
      maxDepth: 10
    },
    variantConstraints: new VariantConstraintManager(),
    combineSimilarNodes: options?.combineSimilarNodes
  });

  if (!options || options.log !== false) {
    treeLogger.logActionTree(tree);
  }

  return tree;
}

/**
 * Internal functions exposed for testing
 * @internal
 */
const _internals = {
  resolveMcData: treeBuild.resolveMcData,
  requiresCraftingTable: treeBuild.requiresCraftingTable,
  renderName,
  chooseMinimalToolName,
  findBlocksThatDrop: treeBuild.findBlocksThatDrop,
  printMiningPath: treeLogger.printMiningPath,
  getIngredientCounts: treeBuild.getIngredientCounts,
  hasCircularDependency: treeBuild.hasCircularDependency,
  printRecipeConversion: treeLogger.printRecipeConversion,
  findMobsThatDrop: treeBuild.findMobsThatDrop,
  printHuntingPath: treeLogger.printHuntingPath,
  buildRecipeTree: treeBuild.buildRecipeTree,
  logActionTree: treeLogger.logActionTree,
  enumerateActionPaths: treeEnumerate.enumerateActionPaths,
  enumerateShortestPathsGenerator: shortestPathsGenerator.enumerateShortestPathsGenerator,
  enumerateActionPathsGenerator: actionPathsGenerator.enumerateActionPathsGenerator,
  computeTreeMaxDepth: treeMetrics.computeTreeMaxDepth,
  countActionPaths: treeMetrics.countActionPaths,
  logActionPath: treeLogger.logActionPath,
  logActionPaths: treeLogger.logActionPaths,
  computePathWeight,
  enumerateLowestWeightPathsGenerator: lowestWeightPathsGenerator.enumerateLowestWeightPathsGenerator
};

// Attach _internals to the plan function for backward compatibility
(plan as any)._internals = _internals;

// Export as both named and default
export default plan;
export { _internals };

