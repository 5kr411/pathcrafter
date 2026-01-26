import { Bot, WorldSnapshot, SnapshotOptions, Position } from './worldSnapshotTypes';
import { beginSnapshotScan, stepSnapshotScan, snapshotFromState } from './worldSnapshot';
import logger from './logger';

const SNAPSHOT_CACHE_TTL_MS = 30000;
const SNAPSHOT_CACHE_MOVE_THRESHOLD = 4;
const SNAPSHOT_CACHE_MOVE_THRESHOLD_SQ = SNAPSHOT_CACHE_MOVE_THRESHOLD * SNAPSHOT_CACHE_MOVE_THRESHOLD;

type SnapshotCacheEntry = {
  snapshot: WorldSnapshot;
  capturedAt: number;
  position: Position;
  radius: number;
  yMin?: number;
  yMax?: number;
  dimension: string;
  version: string;
};

type SnapshotCacheState = {
  entries: Map<string, SnapshotCacheEntry>;
};

const snapshotCache = new WeakMap<Bot, SnapshotCacheState>();

function getCacheState(bot: Bot): SnapshotCacheState {
  let state = snapshotCache.get(bot);
  if (!state) {
    state = { entries: new Map() };
    snapshotCache.set(bot, state);
  }
  return state;
}

function getBotPosition(bot: Bot): Position {
  const pos = bot && bot.entity && bot.entity.position ? bot.entity.position : null;
  if (!pos) return { x: 0, y: 64, z: 0 };
  if (typeof pos.floored === 'function') {
    const floored = pos.floored();
    return { x: floored.x || 0, y: floored.y || 64, z: floored.z || 0 };
  }
  return { x: Math.floor(pos.x || 0), y: Math.floor(pos.y || 64), z: Math.floor(pos.z || 0) };
}

function getBotDimension(bot: Bot): string {
  return (bot && bot.game && bot.game.dimension) ? bot.game.dimension : 'overworld';
}

function getBotVersion(bot: Bot): string {
  return (bot && bot.version) ? bot.version : '1.20.1';
}

function distanceSq(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function cacheKey(radius: number, yMin?: number, yMax?: number): string {
  const minKey = Number.isFinite(yMin as number) ? String(yMin) : 'null';
  const maxKey = Number.isFinite(yMax as number) ? String(yMax) : 'null';
  return `r:${radius}|yMin:${minKey}|yMax:${maxKey}`;
}

function isEntryValid(
  entry: SnapshotCacheEntry,
  now: number,
  position: Position,
  dimension: string,
  version: string
): boolean {
  if (!entry) return false;
  if (entry.dimension !== dimension) return false;
  if (entry.version !== version) return false;
  if (now - entry.capturedAt > SNAPSHOT_CACHE_TTL_MS) return false;
  if (distanceSq(entry.position, position) > SNAPSHOT_CACHE_MOVE_THRESHOLD_SQ) return false;
  return true;
}

function pruneCacheEntries(
  cache: SnapshotCacheState,
  now: number,
  position: Position,
  dimension: string,
  version: string
): void {
  for (const [key, entry] of cache.entries.entries()) {
    if (!isEntryValid(entry, now, position, dimension, version)) {
      cache.entries.delete(key);
    }
  }
}

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
  const startNow = Date.now();
  const startPosition = getBotPosition(bot);
  const dimension = getBotDimension(bot);
  const version = getBotVersion(bot);
  const cache = getCacheState(bot);
  pruneCacheEntries(cache, startNow, startPosition, dimension, version);
  const largestRadius = sortedRadii[sortedRadii.length - 1];
  let lastLargestSnapshot: WorldSnapshot | null = null;

  for (const radius of sortedRadii) {
    attemptsCount++;
    const attemptStart = Date.now();
    const attemptNow = Date.now();
    const attemptPosition = getBotPosition(bot);
    
    if (onProgress) {
      onProgress(`Attempting snapshot with radius ${radius} (attempt ${attemptsCount}/${sortedRadii.length})`);
    }
    logger.info(`AdaptiveSnapshot: attempting radius ${radius} (${attemptsCount}/${sortedRadii.length})`);

    // Build snapshot options
    const snapOpts: SnapshotOptions = { radius };
    if (yMin !== undefined) snapOpts.yMin = yMin;
    if (yMax !== undefined) snapOpts.yMax = yMax;

    const key = cacheKey(radius, yMin, yMax);
    const cachedEntry = cache.entries.get(key);
    const cachedValid = cachedEntry ? isEntryValid(cachedEntry, attemptNow, attemptPosition, dimension, version) : false;
    if (cachedEntry && !cachedValid) {
      cache.entries.delete(key);
    }
    let snapshot: WorldSnapshot;

    if (cachedEntry && cachedValid) {
      snapshot = cachedEntry.snapshot;
      const ageMs = attemptNow - cachedEntry.capturedAt;
      const moved = Math.sqrt(distanceSq(cachedEntry.position, attemptPosition));
      const attemptTime = Date.now() - attemptStart;
      logger.info(`AdaptiveSnapshot: cache hit for radius ${radius} (age ${ageMs} ms, moved ${moved.toFixed(2)} blocks, ${attemptTime} ms)`);
      if (onProgress) {
        onProgress(`Using cached snapshot for radius ${radius}`);
      }
    } else {
      // Single-pass snapshot capture (fast, no incremental scanning)
      const scan = beginSnapshotScan(bot, snapOpts);
      await stepSnapshotScan(scan);

      snapshot = snapshotFromState(scan);
      const attemptTime = Date.now() - attemptStart;
      logger.info(`AdaptiveSnapshot: radius ${radius} captured in ${attemptTime} ms`);

      cache.entries.set(key, {
        snapshot,
        capturedAt: Date.now(),
        position: attemptPosition,
        radius,
        yMin,
        yMax,
        dimension,
        version
      });
    }

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

    if (radius === largestRadius && snapshot) {
      lastLargestSnapshot = snapshot;
    }
  }

  // All radii exhausted, return the largest one
  const totalTime = Date.now() - t0;
  logger.info(`AdaptiveSnapshot: all radii exhausted, returning largest (${largestRadius})`);
  
  if (lastLargestSnapshot) {
    return {
      snapshot: lastLargestSnapshot,
      radiusUsed: largestRadius,
      attemptsCount,
      totalTimeMs: totalTime
    };
  }

  const fallbackKey = cacheKey(largestRadius, yMin, yMax);
  const cachedFallback = cache.entries.get(fallbackKey);
  const fallbackNow = Date.now();
  const fallbackPosition = getBotPosition(bot);
  if (cachedFallback && isEntryValid(cachedFallback, fallbackNow, fallbackPosition, dimension, version)) {
    return {
      snapshot: cachedFallback.snapshot,
      radiusUsed: largestRadius,
      attemptsCount,
      totalTimeMs: totalTime
    };
  }

  // Recapture with largest radius (single-pass)
  const snapOpts: SnapshotOptions = { radius: largestRadius };
  if (yMin !== undefined) snapOpts.yMin = yMin;
  if (yMax !== undefined) snapOpts.yMax = yMax;

  const scan = beginSnapshotScan(bot, snapOpts);
  await stepSnapshotScan(scan);
  const snapshot = snapshotFromState(scan);

  cache.entries.set(fallbackKey, {
    snapshot,
    capturedAt: Date.now(),
    position: fallbackPosition,
    radius: largestRadius,
    yMin,
    yMax,
    dimension,
    version
  });

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
