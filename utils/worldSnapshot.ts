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
const minecraftData = require('minecraft-data');
import logger from './logger';

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

  const blockAgg = new Map<string, AggregationRecord>();

  const tStart = Date.now();
  let positions: any[] = [];
  const botAny = bot as any;
  
  if (botAny && typeof botAny.findBlocksAsync === 'function') {
    positions = await botAny.findBlocksAsync({ 
      matching, 
      maxDistance: maxRadius, 
      count: maxCount,
      yieldEvery: 16
    });
    logger.info(`WorldSnapshot: findBlocksAsync(r=${maxRadius}) found ${positions.length} positions in ${Date.now() - tStart}ms`);
  } else if (bot && typeof bot.findBlocks === 'function') {
    positions = bot.findBlocks({ matching, maxDistance: maxRadius, count: maxCount });
    logger.info(`WorldSnapshot: findBlocks(r=${maxRadius}) found ${positions.length} positions in ${Date.now() - tStart}ms`);
  }

  const tProcess = Date.now();
  const CHUNK_SIZE = 10000;
  let processed = 0;
  
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
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
    
    processed++;
    if (processed % CHUNK_SIZE === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  const totalBlocks = Array.from(blockAgg.values()).reduce((sum, rec) => sum + rec.count, 0);
  logger.info(`WorldSnapshot: processed ${totalBlocks} blocks in ${Date.now() - tProcess}ms (total: ${Date.now() - tStart}ms)`);

  // Yield control briefly
  await new Promise(resolve => setImmediate(resolve));

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

  // Initial step size - starts small for ~50ms shells, then decreases with radius
  const initialStep = (Number.isFinite(opts.step) && opts.step! > 0)
    ? Math.max(1, Math.min(Math.floor(opts.step!), maxRadius))
    : 4; // Small initial step for responsive scanning

  return {
    bot,
    mc,
    includeAir,
    center: { cx, cy, cz },
    maxRadius,
    yMin,
    yMax,
    step: initialStep,
    initialStep,
    r: 0, // Start at 0, will increment to first shell
    prevR: 0,
    shellCount: 0,
    shellStart: Date.now(),
    newBlocksInShell: 0,
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
 * Uses findBlocksAsync if available to yield during scanning, preventing
 * server timeout disconnects. Also processes blocks in chunks with yields.
 * 
 * @param st - Scan state (modified in place)
 * @param budgetMs - Time budget in milliseconds (default 20ms)
 * @returns true if scan is complete, false if more steps needed
 */
export async function stepSnapshotScan(st: ScanState, _budgetMs: number = 20): Promise<boolean> {
  if (st.done) return true;

  if (st.r === 0) {
    const tStart = Date.now();
    
    const matching = (b: any) => {
      if (!b) return false;
      if (!st.includeAir && b.name === 'air') return false;
      const y = b.position?.y;
      if (typeof y === 'number') {
        if (y < st.yMin || y > st.yMax) return false;
      }
      return true;
    };

    let positions: any[] = [];
    const botAny = st.bot as any;
    
    if (botAny && typeof botAny.findBlocksAsync === 'function') {
      positions = await botAny.findBlocksAsync({ 
        matching, 
        maxDistance: st.maxRadius, 
        count: 2147483647,
        yieldEvery: 16
      });
      logger.info(`WorldSnapshot: findBlocksAsync(r=${st.maxRadius}) found ${positions.length} positions in ${Date.now() - tStart}ms`);
    } else if (st.bot && typeof st.bot.findBlocks === 'function') {
      positions = st.bot.findBlocks({ matching, maxDistance: st.maxRadius, count: 2147483647 });
      logger.info(`WorldSnapshot: findBlocks(r=${st.maxRadius}) found ${positions.length} positions in ${Date.now() - tStart}ms`);
    }

    const tProcess = Date.now();
    const CHUNK_SIZE = 10000;
    let processed = 0;
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
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
      
      processed++;
      if (processed % CHUNK_SIZE === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    const totalBlocks = Array.from(st.blockAgg.values()).reduce((sum, rec) => sum + rec.count, 0);
    logger.info(`WorldSnapshot: processed ${totalBlocks} blocks in ${Date.now() - tProcess}ms (total: ${Date.now() - tStart}ms)`);

    st.r = st.maxRadius;
    st.done = true;
  }

  return st.done;
}
