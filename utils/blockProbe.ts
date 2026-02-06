export type SurfaceType = 'land' | 'water' | 'unknown';

export interface BlockAtFn {
  (pos: { x: number; y: number; z: number }, extraInfos?: boolean): any | null;
}

const WATER_NAMES = ['water', 'flowing_water'];

const DEFAULT_MAX_Y = 319;
const DEFAULT_MIN_Y = -64;

export function isWaterBlock(block: any): boolean {
  if (!block || block.type === 0) return false;
  const name = String(block.name || '').toLowerCase();
  return WATER_NAMES.some(w => name.includes(w));
}

export function findSurfaceBlock(
  blockAt: BlockAtFn,
  x: number,
  z: number,
  maxY: number = DEFAULT_MAX_Y,
  minY: number = DEFAULT_MIN_Y
): any | null {
  const floorX = Math.floor(x);
  const floorZ = Math.floor(z);

  for (let y = maxY; y >= minY; y--) {
    const block = blockAt({ x: floorX, y, z: floorZ });
    if (!block) return null;
    if (block.type === 0) continue;
    return block;
  }

  return null;
}

export function checkColumnSurface(
  blockAt: BlockAtFn,
  x: number,
  z: number,
  maxY: number = DEFAULT_MAX_Y,
  minY: number = DEFAULT_MIN_Y
): SurfaceType {
  const block = findSurfaceBlock(blockAt, x, z, maxY, minY);
  if (!block) return 'unknown';
  return isWaterBlock(block) ? 'water' : 'land';
}

export function probeDirectionForWater(
  blockAt: BlockAtFn,
  originX: number,
  originZ: number,
  angle: number,
  maxDistance: number,
  stepBack: number = 16,
  maxY: number = DEFAULT_MAX_Y,
  minY: number = DEFAULT_MIN_Y
): SurfaceType {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);

  for (let dist = maxDistance; dist >= stepBack; dist -= stepBack) {
    const probeX = originX + dist * dx;
    const probeZ = originZ + dist * dz;
    const result = checkColumnSurface(blockAt, probeX, probeZ, maxY, minY);
    if (result !== 'unknown') {
      return result;
    }
  }

  return 'unknown';
}

export function randomAngle(): number {
  return Math.random() * 2 * Math.PI;
}

export function offsetFromAngle(
  x: number,
  z: number,
  angle: number,
  distance: number
): { x: number; z: number } {
  return {
    x: x + distance * Math.cos(angle),
    z: z + distance * Math.sin(angle)
  };
}
