import { AggregationRecord, ResourceStats } from './worldSnapshotTypes';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface BlockLike {
  name?: string;
}

export interface BotLike {
  blockAt?: (pos: any, extraInfos?: boolean) => BlockLike | null;
  entities?: Record<string, { position?: Vec3Like; name?: string; type?: string; kind?: string }>;
}

export function dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function updateAggregation(agg: Map<string, AggregationRecord>, name: string, distance: number): void {
  const rec = agg.get(name) || { count: 0, sumDist: 0, closest: Infinity };
  rec.count += 1;
  rec.sumDist += distance;
  if (distance < rec.closest) rec.closest = distance;
  agg.set(name, rec);
}

export function buildResourceStats(agg: Map<string, AggregationRecord>): Record<string, ResourceStats> {
  const stats: { [name: string]: ResourceStats } = {};
  for (const [name, rec] of agg.entries()) {
    const avg = rec.count > 0 ? rec.sumDist / rec.count : 0;
    stats[name] = {
      count: rec.count,
      closestDistance: rec.closest === Infinity ? null : rec.closest,
      averageDistance: avg
    };
  }
  return stats;
}

export function collectBlockAggregates(params: {
  bot: BotLike;
  positions: Vec3Like[];
  includeAir: boolean;
  center: { x: number; y: number; z: number };
  maxRadius: number;
}): Map<string, AggregationRecord> {
  const { bot, positions, includeAir, center, maxRadius } = params;
  const agg = new Map<string, AggregationRecord>();

  for (const pos of positions) {
    const blk = bot.blockAt ? bot.blockAt(pos, false) : null;
    if (!blk) continue;
    if (!includeAir && blk.name === 'air') continue;
    const name = blk.name;
    if (!name) continue;

    const d = dist(center.x, center.y, center.z, pos.x, pos.y, pos.z);
    if (d > maxRadius) continue;

    updateAggregation(agg, name, d);
  }

  return agg;
}

export function collectEntityStats(bot: BotLike, center: { x: number; y: number; z: number }): Record<string, ResourceStats> {
  const agg = new Map<string, AggregationRecord>();
  if (bot && bot.entities) {
    for (const key in bot.entities) {
      const e = bot.entities[key];
      if (!e || !e.position) continue;
      const n = e.name || e.type || e.kind;
      if (!n) continue;

      const d = dist(center.x, center.y, center.z, e.position.x, e.position.y, e.position.z);
      updateAggregation(agg, n, d);
    }
  }

  return buildResourceStats(agg);
}
