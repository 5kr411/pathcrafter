import { Vec3 } from 'vec3';
const minecraftData = require('minecraft-data');
import logger from './logger';

interface FindBlocksBot {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  blockAt: (pos: Vec3, extraInfos?: boolean) => any;
  entity: { position: Vec3 };
  version?: string;
}

interface FindBlocksOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  matching: number | number[] | ((block: any) => boolean);
  maxDistance: number;
  count: number;
}

/**
 * Non-blocking replacement for bot.findBlocks().
 *
 * Iterates block positions with bot.blockAt(), yielding to the event loop
 * via setImmediate every ~10K checks to prevent keepalive timeouts.
 *
 * Returns matching positions sorted nearest-first, limited to `count`.
 */
export async function findBlocksNonBlocking(
  bot: FindBlocksBot,
  options: FindBlocksOptions
): Promise<Vec3[]> {
  const { matching, maxDistance, count } = options;
  const R = Math.floor(maxDistance);
  const R2 = R * R;

  const center = bot.entity.position;
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);

  // Derive Y bounds from minecraft-data version features
  let yMin = 0;
  let yMax = 255;
  try {
    const mc = bot.version ? minecraftData(bot.version) : null;
    if (mc?.features?.yMin != null) yMin = mc.features.yMin;
    if (mc?.features?.yMax != null) yMax = mc.features.yMax;
  } catch (_) {}

  const yLo = Math.max(yMin, cy - R);
  const yHi = Math.min(yMax, cy + R);
  const xMin = cx - R;
  const xMax = cx + R;
  const zMin = cz - R;
  const zMax = cz + R;

  // Build matcher function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  let matchFn: (block: any) => boolean;
  if (typeof matching === 'function') {
    matchFn = matching;
  } else if (Array.isArray(matching)) {
    const ids = new Set(matching);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
    matchFn = (block: any) => ids.has(block.type);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
    matchFn = (block: any) => block.type === matching;
  }

  const results: { pos: Vec3; d2: number }[] = [];
  let blocksScanned = 0;
  const YIELD_EVERY = 10000;
  const startTime = Date.now();

  for (let x = xMin; x <= xMax; x++) {
    for (let y = yLo; y <= yHi; y++) {
      for (let z = zMin; z <= zMax; z++) {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R2) continue;

        const block = bot.blockAt(new Vec3(x, y, z), false);
        if (!block || block.name === 'air') continue;

        if (matchFn(block)) {
          results.push({ pos: new Vec3(x, y, z), d2 });
        }
      }

      blocksScanned += (zMax - zMin + 1);
      if (blocksScanned >= YIELD_EVERY) {
        blocksScanned = 0;
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }

  // Sort nearest-first, take top `count`
  results.sort((a, b) => a.d2 - b.d2);
  const final = results.slice(0, count).map(r => r.pos);

  const elapsed = Date.now() - startTime;
  logger.info(`findBlocksNonBlocking: r=${R} found ${results.length} matches (returning ${final.length}) in ${elapsed}ms`);

  return final;
}
