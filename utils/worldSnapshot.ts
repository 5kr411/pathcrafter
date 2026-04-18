import * as fs from 'fs';
import * as path from 'path';
import { Vec3 } from 'vec3';
import {
  Bot,
  WorldSnapshot,
  SnapshotOptions,
  ScanState
} from './worldSnapshotTypes';
import {
  buildResourceStats,
  collectEntityStats,
  updateAggregation
} from './worldSnapshotHelpers';
const minecraftData = require('minecraft-data');
import logger from './logger';

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

  return {
    bot,
    mc,
    includeAir,
    center: { cx, cy, cz },
    maxRadius,
    innerRadius: Number.isFinite(opts.innerRadius) ? Math.max(0, opts.innerRadius!) : 0,
    yMin,
    yMax,
    r: 0,
    shellStart: Date.now(),
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
  const blockStats = buildResourceStats(st.blockAgg);
  const entityStats = collectEntityStats(st.bot, { x: st.center.cx, y: st.center.cy, z: st.center.cz });

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
 * Performs a non-blocking world scan using bot.blockAt()
 *
 * Iterates block positions manually instead of using the synchronous
 * bot.findBlocks(), yielding to the event loop periodically to prevent
 * server keepalive timeouts at large radii.
 *
 * @param st - Scan state (modified in place)
 * @param _budgetMs - Unused, kept for API compatibility
 * @returns true if scan is complete, false if more steps needed
 */
export async function stepSnapshotScan(st: ScanState, _budgetMs: number = 40): Promise<boolean> {
  if (st.done) return true;
  if (!st.bot || !st.bot.blockAt) {
    st.done = true;
    return true;
  }

  const { cx, cy, cz } = st.center;
  const R = st.maxRadius;
  const R2 = R * R;
  const innerR2 = st.innerRadius > 0 ? st.innerRadius * st.innerRadius : 0;
  const xMin = cx - R;
  const xMax = cx + R;
  const yLo = Math.max(st.yMin, cy - R);
  const yHi = Math.min(st.yMax, cy + R);
  const zMin = cz - R;
  const zMax = cz + R;

  // Initialize iteration cursor on first call
  if (!st._iterStarted) {
    st._iterStarted = true;
    st._iterX = xMin;
    st.shellStart = Date.now();
    logger.info(`WorldSnapshot: beginning non-blocking scan r=${R} (${xMax - xMin + 1}x${yHi - yLo + 1}x${zMax - zMin + 1} volume)`);
  }

  let x = st._iterX!;
  // Yield budget by wall-clock time rather than block count — block count was
  // a poor proxy because blockAt latency varies (chunk load state, dimension).
  // Keep event loop latency under 15 ms per slice so keepalive responses and
  // socket.write drains don't stall during a scan.
  const YIELD_MS = 15;
  let sliceStart = Date.now();

  while (x <= xMax) {
    for (let y = yLo; y <= yHi; y++) {
      for (let z = zMin; z <= zMax; z++) {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R2) continue;
        if (innerR2 > 0 && d2 <= innerR2) continue;

        const blk = st.bot.blockAt!(new Vec3(x, y, z), false);
        if (!blk) continue;
        if (!st.includeAir && blk.name === 'air') continue;
        const name = blk.name;
        if (!name) continue;

        updateAggregation(st.blockAgg, name, Math.sqrt(d2));
      }

      if (Date.now() - sliceStart >= YIELD_MS) {
        await new Promise(resolve => setImmediate(resolve));
        sliceStart = Date.now();
      }
    }
    x++;
  }

  const totalBlocks = Array.from(st.blockAgg.values()).reduce((sum, rec) => sum + rec.count, 0);
  const elapsed = Date.now() - st.shellStart;
  logger.info(`WorldSnapshot: non-blocking scan r=${R} complete: ${totalBlocks} blocks in ${elapsed}ms`);

  st.r = st.maxRadius;
  st.done = true;
  return true;
}
