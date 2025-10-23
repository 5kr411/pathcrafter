import { Bot, WorldSnapshot, SnapshotOptions } from './worldSnapshotTypes';
import { beginSnapshotScan, stepSnapshotScan, snapshotFromState } from './worldSnapshot';
import logger from './logger';

/**
 * Options for adaptive snapshot capture
 */
export interface AdaptiveSnapshotOptions {
  /** Array of radii to try in order (smallest first) */
  radii: number[];
  
  /** Optional Y bounds */
  yMin?: number;
  yMax?: number;
  
  /** Callback to validate if snapshot is sufficient (returns true if good) */
  validator?: (snapshot: WorldSnapshot) => boolean | Promise<boolean>;
  
  /** Progress callback for logging */
  onProgress?: (message: string) => void;
}

/**
 * Result from adaptive snapshot capture
 */
export interface AdaptiveSnapshotResult {
  /** The captured snapshot */
  snapshot: WorldSnapshot;
  
  /** The radius that was used */
  radiusUsed: number;
  
  /** Number of radii attempted */
  attemptsCount: number;
  
  /** Total time taken in milliseconds */
  totalTimeMs: number;
}

/**
 * Adaptively captures world snapshots starting with smallest radius
 * and progressively increasing until validator passes or all radii exhausted.
 * 
 * This optimizes for the common case where smaller radii are sufficient
 * while still handling edge cases that require larger search areas.
 * 
 * @param bot - Mineflayer bot instance
 * @param opts - Adaptive snapshot options
 * @returns Promise resolving to snapshot result
 * 
 * @example
 * const result = await captureAdaptiveSnapshot(bot, {
 *   radii: [32, 64, 96],
 *   validator: (snapshot) => hasRequiredBlocks(snapshot),
 *   onProgress: (msg) => console.log(msg)
 * });
 */
export async function captureAdaptiveSnapshot(
  bot: Bot,
  opts: AdaptiveSnapshotOptions
): Promise<AdaptiveSnapshotResult> {
  const {
    radii,
    yMin,
    yMax,
    validator,
    onProgress
  } = opts;

  if (!radii || radii.length === 0) {
    throw new Error('At least one radius must be provided');
  }

  const sortedRadii = [...radii].sort((a, b) => a - b);
  const t0 = Date.now();
  let attemptsCount = 0;

  for (const radius of sortedRadii) {
    attemptsCount++;
    const attemptStart = Date.now();
    
    if (onProgress) {
      onProgress(`Attempting snapshot with radius ${radius} (attempt ${attemptsCount}/${sortedRadii.length})`);
    }
    logger.info(`AdaptiveSnapshot: attempting radius ${radius} (${attemptsCount}/${sortedRadii.length})`);

    // Build snapshot options
    const snapOpts: SnapshotOptions = { radius };
    if (yMin !== undefined) snapOpts.yMin = yMin;
    if (yMax !== undefined) snapOpts.yMax = yMax;

    // Single-pass snapshot capture (fast, no incremental scanning)
    const scan = beginSnapshotScan(bot, snapOpts);
    await stepSnapshotScan(scan);

    const snapshot = snapshotFromState(scan);
    const attemptTime = Date.now() - attemptStart;
    logger.info(`AdaptiveSnapshot: radius ${radius} captured in ${attemptTime} ms`);

    // Validate if provided
    if (validator) {
      const isValid = await validator(snapshot);
      if (isValid) {
        const totalTime = Date.now() - t0;
        logger.info(`AdaptiveSnapshot: radius ${radius} validated successfully (total ${totalTime} ms)`);
        if (onProgress) {
          onProgress(`Snapshot validated at radius ${radius}`);
        }
        return {
          snapshot,
          radiusUsed: radius,
          attemptsCount,
          totalTimeMs: totalTime
        };
      } else {
        logger.info(`AdaptiveSnapshot: radius ${radius} failed validation, trying next radius`);
        if (onProgress) {
          onProgress(`Radius ${radius} insufficient, trying larger radius...`);
        }
      }
    } else {
      // No validator, return first successful capture
      const totalTime = Date.now() - t0;
      logger.info(`AdaptiveSnapshot: radius ${radius} captured (total ${totalTime} ms)`);
      return {
        snapshot,
        radiusUsed: radius,
        attemptsCount,
        totalTimeMs: totalTime
      };
    }
  }

  // All radii exhausted, return the largest one
  const largestRadius = sortedRadii[sortedRadii.length - 1];
  const totalTime = Date.now() - t0;
  logger.info(`AdaptiveSnapshot: all radii exhausted, returning largest (${largestRadius})`);
  
  // Recapture with largest radius (single-pass)
  const snapOpts: SnapshotOptions = { radius: largestRadius };
  if (yMin !== undefined) snapOpts.yMin = yMin;
  if (yMax !== undefined) snapOpts.yMax = yMax;
  
  const scan = beginSnapshotScan(bot, snapOpts);
  await stepSnapshotScan(scan);
  const snapshot = snapshotFromState(scan);

  return {
    snapshot,
    radiusUsed: largestRadius,
    attemptsCount,
    totalTimeMs: totalTime
  };
}

/**
 * Creates a validator function that checks if paths can be generated
 * from a snapshot for a given planning request.
 * 
 * @param mcVersion - Minecraft version
 * @param item - Item to plan for
 * @param count - Item count
 * @param inventory - Current inventory
 * @param plannerFn - Planner function to use
 * @param pathGeneratorFn - Path generator function
 * @returns Validator function
 */
export function createPathValidator(
  mcVersion: string,
  item: string,
  count: number,
  inventory: Record<string, number>,
  plannerFn: any,
  pathGeneratorFn: any
): (snapshot: WorldSnapshot) => Promise<boolean> {
  return async (_snapshot: WorldSnapshot): Promise<boolean> => {
    try {
      logger.info(`AdaptiveSnapshot: validating with path generation for ${item} x${count}`);
      
      // Build tree without world pruning - we just want to validate that paths
      // CAN be generated with the given inventory, not prune based on world
      const mcData = plannerFn._internals.resolveMcData(mcVersion);
      const inventoryMap = new Map(Object.entries(inventory));
      const tree = plannerFn(mcData, item, count, {
        inventory: inventoryMap,
        log: false
      });

      if (!tree) {
        logger.info(`AdaptiveSnapshot: validation failed - no tree generated`);
        return false;
      }

      // Try to generate at least one path
      const paths = [];
      const iter = pathGeneratorFn(tree, { inventory });
      
      for (const p of iter) {
        paths.push(p);
        if (paths.length >= 1) break; // Just need one valid path
      }

      const hasValidPath = paths.length > 0;
      logger.info(`AdaptiveSnapshot: validation ${hasValidPath ? 'passed' : 'failed'} (${paths.length} paths)`);
      return hasValidPath;
    } catch (err) {
      logger.info(`AdaptiveSnapshot: validation error - ${err}`);
      return false;
    }
  };
}

