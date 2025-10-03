import * as fs from 'fs';
import * as path from 'path';
import {
  Bot,
  WorldSnapshot,
  SnapshotOptions,
  ScanState,
  AggregationRecord,
  ResourceStats
} from './worldSnapshotTypes';
import { WorkerPool } from './workerPool';

const minecraftData = require('minecraft-data');
const logger = require(path.resolve(__dirname, '../../utils/logger'));

// Global snapshot worker pool (lazy initialized)
let snapshotWorkerPool: WorkerPool | null = null;

function getSnapshotWorkerPool(): WorkerPool {
  if (!snapshotWorkerPool) {
    const workerPath = path.resolve(__dirname, '../workers/snapshot_worker.js');
    snapshotWorkerPool = new WorkerPool(workerPath, 4); // 4 workers for parallel processing
    logger.info('WorldSnapshot: created snapshot worker pool (4 workers)');
  }
  return snapshotWorkerPool;
}

/**
 * Calculates Euclidean distance between two 3D points
 */
function dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Captures a summarized snapshot of world data near the bot
 * 
 * Instead of returning every block/entity position, aggregates by type with statistics:
 * { count, closestDistance, averageDistance } relative to the bot center.
 * 
 * @param bot - Mineflayer bot instance
 * @param opts - Snapshot capture options
 * @returns World snapshot with aggregated resource data
 * 
 * @example
 * const snapshot = captureRawWorldSnapshot(bot, {
 *   radius: 64,
 *   includeAir: false,
 *   yMin: -64,
 *   yMax: 320
 * });
 */
export function captureRawWorldSnapshot(bot: Bot, opts: SnapshotOptions = {}): WorldSnapshot {
  const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
  const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
  const includeAir = !!opts.includeAir;

  // Calculate scan radius
  const legacyChunkRadius = Number.isFinite(opts.chunkRadius) 
    ? Math.max(0, Math.min(opts.chunkRadius!, 8)) 
    : null;
  const explicitRadius = Number.isFinite(opts.radius) 
    ? Math.max(1, Math.min(opts.radius!, 1024)) 
    : null;
  const maxDistance = explicitRadius != null
    ? explicitRadius
    : Math.max(1, Math.min((((legacyChunkRadius != null ? legacyChunkRadius : 2) * 16) + 15), 1024));

  // Get bot center position
  const center = bot && bot.entity && bot.entity.position 
    ? bot.entity.position.floored() 
    : { x: 0, y: 64, z: 0 };
  const cx = center.x || 0;
  const cy = center.y || 64;
  const cz = center.z || 0;

  // Determine Y bounds
  const defaultYMax = typeof mc?.features?.yMax === 'number' ? mc.features.yMax : 255;
  const defaultYMin = typeof mc?.features?.yMin === 'number' ? mc.features.yMin : 0;
  const yMin = Number.isFinite(opts.yMin) ? opts.yMin! : defaultYMin;
  const yMax = Number.isFinite(opts.yMax) ? opts.yMax! : defaultYMax;

  const maxCount = 2147483647;
  const matching = (b: any) => {
    if (!b) return false;
    if (!includeAir && b.name === 'air') return false;
    const y = b.position?.y;
    if (typeof y === 'number') {
      if (y < yMin || y > yMax) return false;
    }
    return true;
  };

  // Collect positions of all blocks within radius that match predicate
  const positions = (bot && typeof bot.findBlocks === 'function')
    ? bot.findBlocks({ matching, maxDistance, count: maxCount })
    : [];

  // Aggregate block statistics by name
  const blockAgg = new Map<string, AggregationRecord>();
  for (const pos of positions) {
    const blk = bot.blockAt!(pos, false);
    if (!blk) continue;
    if (!includeAir && blk.name === 'air') continue;
    const name = blk.name;
    if (!name) continue;

    const d = dist(cx, cy, cz, pos.x, pos.y, pos.z);
    const rec = blockAgg.get(name) || { count: 0, sumDist: 0, closest: Infinity };
    rec.count += 1;
    rec.sumDist += d;
    if (d < rec.closest) rec.closest = d;
    blockAgg.set(name, rec);
  }

  const blockStats: { [name: string]: ResourceStats } = {};
  for (const [name, rec] of blockAgg.entries()) {
    const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
    blockStats[name] = {
      count: rec.count,
      closestDistance: rec.closest === Infinity ? null : rec.closest,
      averageDistance: avg
    };
  }

  // Aggregate entity statistics by preferred name
  const entityAgg = new Map<string, AggregationRecord>();
  if (bot && bot.entities) {
    for (const key in bot.entities) {
      const e = bot.entities[key];
      if (!e || !e.position) continue;
      const n = e.name || e.type || e.kind;
      if (!n) continue;

      const d = dist(cx, cy, cz, e.position.x, e.position.y, e.position.z);
      const rec = entityAgg.get(n) || { count: 0, sumDist: 0, closest: Infinity };
      rec.count += 1;
      rec.sumDist += d;
      if (d < rec.closest) rec.closest = d;
      entityAgg.set(n, rec);
    }
  }

  const entityStats: { [name: string]: ResourceStats } = {};
  for (const [name, rec] of entityAgg.entries()) {
    const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
    entityStats[name] = {
      count: rec.count,
      closestDistance: rec.closest === Infinity ? null : rec.closest,
      averageDistance: avg
    };
  }

  return {
    version,
    dimension: bot && bot.game && bot.game.dimension ? bot.game.dimension : 'overworld',
    center: { x: cx, y: cy, z: cz },
    radius: maxDistance,
    yMin,
    yMax,
    blocks: blockStats,
    entities: entityStats
  };
}

/**
 * Saves a world snapshot to a JSON file
 * 
 * @param snapshot - World snapshot to save
 * @param filePath - Path to save the snapshot file
 */
export function saveSnapshotToFile(snapshot: WorldSnapshot, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

/**
 * Loads a world snapshot from a JSON file
 * 
 * @param filePath - Path to the snapshot file
 * @returns Loaded world snapshot
 */
export function loadSnapshotFromFile(filePath: string): WorldSnapshot {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Async, non-blocking snapshotter that yields between distance shells
 * 
 * This version avoids long event-loop stalls by processing the world in
 * concentric shells and yielding control between each shell.
 * 
 * @param bot - Mineflayer bot instance
 * @param opts - Snapshot capture options
 * @returns Promise resolving to world snapshot
 */
export async function captureRawWorldSnapshotAsync(bot: Bot, opts: SnapshotOptions = {}): Promise<WorldSnapshot> {
  const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
  const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
  const includeAir = !!opts.includeAir;

  const legacyChunkRadius = Number.isFinite(opts.chunkRadius) 
    ? Math.max(0, Math.min(opts.chunkRadius!, 8)) 
    : null;
  const explicitRadius = Number.isFinite(opts.radius) 
    ? Math.max(1, Math.min(opts.radius!, 1024)) 
    : null;
  const maxRadius = explicitRadius != null
    ? explicitRadius
    : Math.max(1, Math.min((((legacyChunkRadius != null ? legacyChunkRadius : 2) * 16) + 15), 1024));

  const center = bot && bot.entity && bot.entity.position 
    ? bot.entity.position.floored() 
    : { x: 0, y: 64, z: 0 };
  const cx = center.x || 0;
  const cy = center.y || 64;
  const cz = center.z || 0;

  const defaultYMax = typeof mc?.features?.yMax === 'number' ? mc.features.yMax : 255;
  const defaultYMin = typeof mc?.features?.yMin === 'number' ? mc.features.yMin : 0;
  const yMin = Number.isFinite(opts.yMin) ? opts.yMin! : defaultYMin;
  const yMax = Number.isFinite(opts.yMax) ? opts.yMax! : defaultYMax;

  const maxCount = 2147483647;
  const matching = (b: any) => {
    if (!b) return false;
    if (!includeAir && b.name === 'air') return false;
    const y = b.position?.y;
    if (typeof y === 'number') {
      if (y < yMin || y > yMax) return false;
    }
    return true;
  };

  const seen = new Set<string>();
  const blockAgg = new Map<string, AggregationRecord>();

  // Calculate step size for shell-based scanning
  const step = (Number.isFinite(opts.step) && opts.step! > 0)
    ? Math.max(1, Math.min(Math.floor(opts.step!), maxRadius))
    : Math.max(32, Math.min(96, Math.floor(maxRadius / 4) || 32));

  // Scan in shells, yielding between each
  for (let r = step; r <= maxRadius + 1; r += step) {
    const shellMax = Math.min(r, maxRadius);
    const positions = (bot && typeof bot.findBlocks === 'function')
      ? bot.findBlocks({ matching, maxDistance: shellMax, count: maxCount })
      : [];

    for (const pos of positions) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const blk = bot.blockAt!(pos, false);
      if (!blk) continue;
      if (!includeAir && blk.name === 'air') continue;
      const name = blk.name;
      if (!name) continue;

      const d = dist(cx, cy, cz, pos.x, pos.y, pos.z);
      if (d > maxRadius) continue;

      const rec = blockAgg.get(name) || { count: 0, sumDist: 0, closest: Infinity };
      rec.count += 1;
      rec.sumDist += d;
      if (d < rec.closest) rec.closest = d;
      blockAgg.set(name, rec);
    }

    // Yield control to event loop
    await new Promise(resolve => setImmediate(resolve));
  }

  const blockStats: { [name: string]: ResourceStats } = {};
  for (const [name, rec] of blockAgg.entries()) {
    const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
    blockStats[name] = {
      count: rec.count,
      closestDistance: rec.closest === Infinity ? null : rec.closest,
      averageDistance: avg
    };
  }

  // Entities are inexpensive; do once
  const entityAgg = new Map<string, AggregationRecord>();
  if (bot && bot.entities) {
    for (const key in bot.entities) {
      const e = bot.entities[key];
      if (!e || !e.position) continue;
      const n = e.name || e.type || e.kind;
      if (!n) continue;

      const d = dist(cx, cy, cz, e.position.x, e.position.y, e.position.z);
      const rec = entityAgg.get(n) || { count: 0, sumDist: 0, closest: Infinity };
      rec.count += 1;
      rec.sumDist += d;
      if (d < rec.closest) rec.closest = d;
      entityAgg.set(n, rec);
    }
  }

  const entityStats: { [name: string]: ResourceStats } = {};
  for (const [name, rec] of entityAgg.entries()) {
    const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
    entityStats[name] = {
      count: rec.count,
      closestDistance: rec.closest === Infinity ? null : rec.closest,
      averageDistance: avg
    };
  }

  return {
    version,
    dimension: bot && bot.game && bot.game.dimension ? bot.game.dimension : 'overworld',
    center: { x: cx, y: cy, z: cz },
    radius: maxRadius,
    yMin,
    yMax,
    blocks: blockStats,
    entities: entityStats
  };
}

/**
 * Begins an incremental snapshot scan (time-sliced state machine)
 * 
 * This allows scanning to be performed incrementally over multiple frames,
 * preventing event loop blocking. Call stepSnapshotScan() repeatedly until done.
 * 
 * @param bot - Mineflayer bot instance
 * @param opts - Snapshot capture options
 * @returns Initial scan state
 */
export function beginSnapshotScan(bot: Bot, opts: SnapshotOptions = {}): ScanState {
  const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
  const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
  const includeAir = !!opts.includeAir;

  const legacyChunkRadius = Number.isFinite(opts.chunkRadius) 
    ? Math.max(0, Math.min(opts.chunkRadius!, 8)) 
    : null;
  const explicitRadius = Number.isFinite(opts.radius) 
    ? Math.max(1, Math.min(opts.radius!, 1024)) 
    : null;
  const maxRadius = explicitRadius != null
    ? explicitRadius
    : Math.max(1, Math.min((((legacyChunkRadius != null ? legacyChunkRadius : 2) * 16) + 15), 1024));

  const center = bot && bot.entity && bot.entity.position 
    ? bot.entity.position.floored() 
    : { x: 0, y: 64, z: 0 };
  const cx = center.x || 0;
  const cy = center.y || 64;
  const cz = center.z || 0;

  const defaultYMax = typeof mc?.features?.yMax === 'number' ? mc.features.yMax : 255;
  const defaultYMin = typeof mc?.features?.yMin === 'number' ? mc.features.yMin : 0;
  const yMin = Number.isFinite(opts.yMin) ? opts.yMin! : defaultYMin;
  const yMax = Number.isFinite(opts.yMax) ? opts.yMax! : defaultYMax;

  const step = Math.max(32, Math.min(96, Math.floor(maxRadius / 4) || 32));

  return {
    bot,
    mc,
    includeAir,
    center: { cx, cy, cz },
    maxRadius,
    yMin,
    yMax,
    step,
    r: step,
    seen: new Set(),
    blockAgg: new Map(),
    done: false
  };
}

/**
 * Converts scan state to a complete snapshot
 * 
 * Can be called at any point during scanning to get partial results,
 * or after completion for the final snapshot.
 * 
 * @param st - Scan state
 * @returns World snapshot from current state
 */
export function snapshotFromState(st: ScanState): WorldSnapshot {
  const blockStats: { [name: string]: ResourceStats } = {};
  for (const [name, rec] of st.blockAgg.entries()) {
    const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
    blockStats[name] = {
      count: rec.count,
      closestDistance: rec.closest === Infinity ? null : rec.closest,
      averageDistance: avg
    };
  }

  // Track entities with intermediate aggregation structure
  const entityAggTemp = new Map<string, { count: number; sumDist: number; closest: number | null }>();
  if (st.bot && st.bot.entities) {
    for (const key in st.bot.entities) {
      const e = st.bot.entities[key];
      if (!e || !e.position) continue;
      const n = e.name || e.type || e.kind;
      if (!n) continue;

      const d = dist(st.center.cx, st.center.cy, st.center.cz, e.position.x, e.position.y, e.position.z);
      const rec = entityAggTemp.get(n) || { count: 0, sumDist: 0, closest: null };
      rec.count += 1;
      rec.sumDist += d;
      if (rec.closest == null || d < rec.closest) {
        rec.closest = d;
      }
      entityAggTemp.set(n, rec);
    }
  }

  const entityStats: { [name: string]: ResourceStats } = {};
  for (const [name, rec] of entityAggTemp.entries()) {
    const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
    entityStats[name] = {
      count: rec.count,
      closestDistance: rec.closest,
      averageDistance: avg
    };
  }

  return {
    version: st.bot && st.bot.version ? st.bot.version : '1.20.1',
    dimension: st.bot && st.bot.game && st.bot.game.dimension ? st.bot.game.dimension : 'overworld',
    center: { x: st.center.cx, y: st.center.cy, z: st.center.cz },
    radius: st.maxRadius,
    yMin: st.yMin,
    yMax: st.yMax,
    blocks: blockStats,
    entities: entityStats
  };
}

/**
 * Computes accurate scan progress as ratio of scanned volume to total volume
 * 
 * Treats the scanned region as a sphere of radius r centered at cy, clipped
 * by vertical bounds. Progress is continuous-volume based and reflects r^3 growth.
 * 
 * @param st - Scan state
 * @returns Progress ratio between 0 and 1
 */
export function scanProgressFromState(st: ScanState | null | undefined): number {
  if (!st || typeof st.maxRadius !== 'number' || typeof st.r !== 'number') return 0;

  const R = Math.max(0, st.maxRadius || 0);
  if (R === 0) return 1;

  const r = Math.max(0, Math.min(st.r || 0, R));
  const cy = (st.center && typeof st.center.cy === 'number') ? st.center.cy : 64;
  const yMin = (typeof st.yMin === 'number') ? st.yMin : (cy - R);
  const yMax = (typeof st.yMax === 'number') ? st.yMax : (cy + R);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Relative coordinates to sphere center
  const t1R = clamp(yMin - cy, -R, R);
  const t2R = clamp(yMax - cy, -R, R);
  if (!(t2R > t1R)) return 1; // degenerate or out-of-range => treat as done

  const t1r = clamp(yMin - cy, -r, r);
  const t2r = clamp(yMax - cy, -r, r);

  const PI = Math.PI;

  // Calculate volume of spherical segment
  const segmentVolume = (rad: number, a: number, b: number): number => {
    if (!(b > a)) return 0;
    // ∫_a^b π(rad^2 - t^2) dt = π [ rad^2 t - t^3/3 ]_a^b
    return PI * ((rad * rad) * (b - a) - ((b * b * b) - (a * a * a)) / 3);
  };

  const Vtot = segmentVolume(R, t1R, t2R);
  if (Vtot <= 0) return 1;

  const Vnow = segmentVolume(r, t1r, t2r);
  const ratio = Math.max(0, Math.min(1, Vnow / Vtot));
  return ratio;
}

/**
 * Performs one step of incremental scanning
 * 
 * Processes blocks for up to budgetMs milliseconds, then returns.
 * Call repeatedly until it returns true (scan complete).
 * 
 * @param st - Scan state (modified in place)
 * @param budgetMs - Time budget in milliseconds (default 20ms)
 * @returns true if scan is complete, false if more steps needed
 */
export async function stepSnapshotScan(st: ScanState, budgetMs: number = 20): Promise<boolean> {
  const t0 = Date.now();
  if (st.done) return true;

  const matching = (b: any) => {
    if (!b) return false;
    if (!st.includeAir && b.name === 'air') return false;
    const y = b.position?.y;
    if (typeof y === 'number') {
      if (y < st.yMin || y > st.yMax) return false;
    }
    return true;
  };

  while (Date.now() - t0 < budgetMs) {
    const r = Math.min(st.r, st.maxRadius);
    const positions = (st.bot && typeof st.bot.findBlocks === 'function')
      ? st.bot.findBlocks({ matching, maxDistance: r, count: 2147483647 })
      : [];

    for (const pos of positions) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      if (st.seen.has(key)) continue;
      st.seen.add(key);

      const blk = st.bot.blockAt!(pos, false);
      if (!blk) continue;
      if (!st.includeAir && blk.name === 'air') continue;
      const name = blk.name;
      if (!name) continue;

      const d = dist(st.center.cx, st.center.cy, st.center.cz, pos.x, pos.y, pos.z);
      if (d > st.maxRadius) continue;

      const rec = st.blockAgg.get(name) || { count: 0, sumDist: 0, closest: Infinity };
      rec.count += 1;
      rec.sumDist += d;
      if (d < rec.closest) rec.closest = d;
      st.blockAgg.set(name, rec);
    }

    if (st.r >= st.maxRadius) {
      st.done = true;
      break;
    }

    st.r += st.step;
    await new Promise(resolve => setImmediate(resolve));

    if (Date.now() - t0 >= budgetMs) break;
  }

  return st.done;
}

/**
 * Fast parallel world snapshot using worker pool
 * 
 * This version:
 * 1. Quickly collects all block/entity positions in main thread
 * 2. Divides work into batches
 * 3. Processes batches in parallel workers (distance calc + aggregation)
 * 4. Merges results
 * 
 * @param bot - Mineflayer bot instance
 * @param opts - Snapshot capture options
 * @returns Promise resolving to world snapshot
 */
export async function captureWorldSnapshotParallel(bot: Bot, opts: SnapshotOptions = {}): Promise<WorldSnapshot> {
  const version = bot && bot.version ? bot.version : (opts.version || '1.20.1');
  const mc = typeof opts.mcData === 'object' && opts.mcData ? opts.mcData : minecraftData(version);
  const includeAir = !!opts.includeAir;

  const legacyChunkRadius = Number.isFinite(opts.chunkRadius) 
    ? Math.max(0, Math.min(opts.chunkRadius!, 8)) 
    : null;
  const explicitRadius = Number.isFinite(opts.radius) 
    ? Math.max(1, Math.min(opts.radius!, 1024)) 
    : null;
  const maxRadius = explicitRadius != null
    ? explicitRadius
    : Math.max(1, Math.min((((legacyChunkRadius != null ? legacyChunkRadius : 2) * 16) + 15), 1024));

  const center = bot && bot.entity && bot.entity.position 
    ? bot.entity.position.floored() 
    : { x: 0, y: 64, z: 0 };
  const cx = center.x || 0;
  const cy = center.y || 64;
  const cz = center.z || 0;

  const defaultYMax = typeof mc?.features?.yMax === 'number' ? mc.features.yMax : 255;
  const defaultYMin = typeof mc?.features?.yMin === 'number' ? mc.features.yMin : 0;
  const yMin = Number.isFinite(opts.yMin) ? opts.yMin! : defaultYMin;
  const yMax = Number.isFinite(opts.yMax) ? opts.yMax! : defaultYMax;

  const maxCount = 2147483647;
  const matching = (b: any) => {
    if (!b) return false;
    if (!includeAir && b.name === 'air') return false;
    const y = b.position?.y;
    if (typeof y === 'number') {
      if (y < yMin || y > yMax) return false;
    }
    return true;
  };

  // Step 1: Collect all block positions (fast, main thread)
  const t0 = Date.now();
  logger.info(`WorldSnapshot: collecting block positions (radius=${maxRadius})`);
  const positions = (bot && typeof bot.findBlocks === 'function')
    ? bot.findBlocks({ matching, maxDistance: maxRadius, count: maxCount })
    : [];
  
  const t1 = Date.now();
  logger.info(`WorldSnapshot: found ${positions.length} block positions in ${t1 - t0} ms`);

  // Extract block data
  const blocks: Array<{ name: string; x: number; y: number; z: number }> = [];
  for (const pos of positions) {
    const blk = bot.blockAt!(pos, false);
    if (!blk || !blk.name) continue;
    blocks.push({ name: blk.name, x: pos.x, y: pos.y, z: pos.z });
  }
  
  const t2 = Date.now();
  logger.info(`WorldSnapshot: extracted ${blocks.length} block details in ${t2 - t1} ms`);

  // Collect entity data
  const entities: Array<{ name: string; x: number; y: number; z: number }> = [];
  try {
    if (bot && bot.entities && typeof bot.entities === 'object') {
      const st = bot.entities as { [id: string]: any };
      for (const id in st) {
        const e: any = st[id];
        if (!e || !e.position || !e.name) continue;
        const ex = e.position.x;
        const ey = e.position.y;
        const ez = e.position.z;
        if (typeof ex !== 'number' || typeof ey !== 'number' || typeof ez !== 'number') continue;
        const d = dist(ex, ey, ez, cx, cy, cz);
        if (d > maxRadius) continue;
        entities.push({ name: e.name, x: ex, y: ey, z: ez });
      }
    }
  } catch (_) {
    // Ignore entity collection errors
  }
  
  const t3 = Date.now();
  logger.info(`WorldSnapshot: collected ${entities.length} entities in ${t3 - t2} ms`)

  // Step 2: Divide into batches for parallel processing
  const pool = getSnapshotWorkerPool();
  await pool.init();
  
  const poolStats = pool.getStats();
  logger.info(`WorldSnapshot: worker pool ready (${poolStats.total} workers, ${poolStats.available} available)`);

  const batchSize = Math.max(100, Math.ceil(blocks.length / 4)); // Divide among workers
  const batches: Array<{
    blocks: Array<{ name: string; x: number; y: number; z: number }>;
    entities: Array<{ name: string; x: number; y: number; z: number }>;
  }> = [];

  for (let i = 0; i < blocks.length; i += batchSize) {
    batches.push({
      blocks: blocks.slice(i, i + batchSize),
      entities: i === 0 ? entities : [] // Only send entities with first batch
    });
  }
  
  logger.info(`WorldSnapshot: divided into ${batches.length} batches (${batchSize} blocks/batch)`)

  // Step 3: Process batches in parallel
  const t4 = Date.now();
  logger.info(`WorldSnapshot: starting parallel processing of ${batches.length} batches`);
  
  const results = await Promise.all(
    batches.map((batch, idx) =>
      pool.execute(worker => {
        return new Promise<any>((resolve) => {
          const id = `${Date.now()}_${idx}`;
          const batchStart = Date.now();
          
          const timeout = setTimeout(() => {
            logger.info(`WorldSnapshot: batch ${idx} timeout after 10s`);
            resolve({ blockStats: {}, entityStats: {} });
          }, 10000); // 10 second timeout per batch

          const messageHandler = (msg: any) => {
            clearTimeout(timeout);
            const batchTime = Date.now() - batchStart;
            
            if (msg && msg.type === 'result' && msg.id === id && msg.ok) {
              const blockCount = Object.keys(msg.blockStats || {}).length;
              const entityCount = Object.keys(msg.entityStats || {}).length;
              logger.info(`WorldSnapshot: batch ${idx} complete in ${batchTime} ms (${blockCount} block types, ${entityCount} entity types)`);
              worker.removeListener('message', messageHandler);
              resolve({
                blockStats: msg.blockStats || {},
                entityStats: msg.entityStats || {}
              });
            } else {
              logger.info(`WorldSnapshot: batch ${idx} failed after ${batchTime} ms`);
              worker.removeListener('message', messageHandler);
              resolve({ blockStats: {}, entityStats: {} });
            }
          };

          worker.on('message', messageHandler);
          worker.postMessage({
            type: 'process',
            id,
            blocks: batch.blocks,
            entities: batch.entities,
            centerX: cx,
            centerY: cy,
            centerZ: cz
          });
        });
      })
    )
  );
  
  const t5 = Date.now();
  logger.info(`WorldSnapshot: all batches processed in ${t5 - t4} ms`);

  // Step 4: Merge results from all workers
  const t6 = Date.now();
  logger.info(`WorldSnapshot: merging results from ${results.length} batches`);
  
  const blockAgg = new Map<string, AggregationRecord>();
  const entityAgg = new Map<string, AggregationRecord>();

  for (const result of results) {
    // Merge blocks
    for (const [name, stats] of Object.entries(result.blockStats)) {
      const s = stats as AggregationRecord;
      const existing = blockAgg.get(name);
      if (existing) {
        existing.count += s.count;
        existing.sumDist += s.sumDist;
        if (s.closest < existing.closest) {
          existing.closest = s.closest;
        }
      } else {
        blockAgg.set(name, { ...s });
      }
    }

    // Merge entities
    for (const [name, stats] of Object.entries(result.entityStats)) {
      const s = stats as AggregationRecord;
      const existing = entityAgg.get(name);
      if (existing) {
        existing.count += s.count;
        existing.sumDist += s.sumDist;
        if (s.closest < existing.closest) {
          existing.closest = s.closest;
        }
      } else {
        entityAgg.set(name, { ...s });
      }
    }
  }
  
  const t7 = Date.now();
  logger.info(`WorldSnapshot: merged results in ${t7 - t6} ms (${blockAgg.size} block types, ${entityAgg.size} entity types)`);

  // Convert to final format
  const blockStats: Record<string, ResourceStats> = {};
  blockAgg.forEach((agg, name) => {
    blockStats[name] = {
      count: agg.count,
      closestDistance: agg.closest,
      averageDistance: agg.count > 0 ? agg.sumDist / agg.count : agg.closest
    };
  });

  const entityStats: Record<string, ResourceStats> = {};
  entityAgg.forEach((agg, name) => {
    entityStats[name] = {
      count: agg.count,
      closestDistance: agg.closest,
      averageDistance: agg.count > 0 ? agg.sumDist / agg.count : agg.closest
    };
  });

  const totalTime = Date.now() - t0;
  logger.info(`WorldSnapshot: parallel snapshot complete in ${totalTime} ms total`);
  logger.info(`WorldSnapshot: breakdown - collect:${t1-t0}ms, extract:${t2-t1}ms, entities:${t3-t2}ms, process:${t5-t4}ms, merge:${t7-t6}ms`);

  return {
    version,
    dimension: 'overworld',
    center: { x: cx, y: cy, z: cz },
    radius: maxRadius,
    yMin,
    yMax,
    blocks: blockStats,
    entities: entityStats
  };
}

