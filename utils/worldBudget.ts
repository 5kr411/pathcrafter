/**
 * World resource budget tracking and reservation
 * 
 * Manages available resources in the world and tracks consumption during planning
 */

/**
 * World budget structure tracking available blocks and entities
 */
export interface WorldBudget {
  blocks: Record<string, number>;
  blocksInfo: Record<string, { closestDistance: number }>;
  entities: Record<string, number>;
  entitiesInfo: Record<string, { closestDistance: number }>;
  distanceThreshold: number;
  allowedBlocksWithinThreshold: Set<string>;
  allowedEntitiesWithinThreshold: Set<string>;
}

/**
 * Resource kind (blocks or entities)
 */
export type ResourceKind = 'blocks' | 'entities';

/**
 * Checks if a resource can be consumed from the world budget
 * 
 * @param worldBudget - Current world budget
 * @param kind - Resource kind ('blocks' or 'entities')
 * @param name - Resource name
 * @param amount - Amount to consume
 * @returns true if the resource can be consumed
 */
export function canConsumeWorld(
  worldBudget: WorldBudget | null | undefined,
  kind: ResourceKind,
  name: string,
  amount: number
): boolean {
  if (!worldBudget || amount <= 0) return true;

  const pool = worldBudget[kind];
  if (!pool) return true;

  const have = pool[name] || 0;
  const allowSet = kind === 'blocks' 
    ? worldBudget.allowedBlocksWithinThreshold 
    : worldBudget.allowedEntitiesWithinThreshold;

  if (allowSet && allowSet.has && have > 0) {
    if (!allowSet.has(name)) return false;
  } else if (have > 0 && worldBudget && worldBudget[`${kind}Info`]) {
    const info = worldBudget[`${kind}Info`][name];
    const closest = info && Number.isFinite(info.closestDistance) ? info.closestDistance : Infinity;
    const thresh = Number.isFinite(worldBudget.distanceThreshold) ? worldBudget.distanceThreshold : Infinity;
    if (!(closest <= thresh)) return false;
  }

  return have >= amount;
}

/**
 * Consumes a resource from the world budget
 * 
 * @param worldBudget - Current world budget
 * @param kind - Resource kind ('blocks' or 'entities')
 * @param name - Resource name
 * @param amount - Amount to consume
 */
export function consumeWorld(
  worldBudget: WorldBudget | null | undefined,
  kind: ResourceKind,
  name: string,
  amount: number
): void {
  if (!worldBudget || amount <= 0) return;

  const pool = worldBudget[kind];
  if (!pool) return;

  const have = pool[name] || 0;
  pool[name] = Math.max(0, have - amount);
}

/**
 * Sums available amount across multiple resource names
 * 
 * @param worldBudget - Current world budget
 * @param kind - Resource kind ('blocks' or 'entities')
 * @param names - Array of resource names to sum
 * @returns Total available amount
 */
export function sumAvailable(
  worldBudget: WorldBudget | null | undefined,
  kind: ResourceKind,
  names: string[]
): number {
  if (!worldBudget) return Number.POSITIVE_INFINITY;

  const pool = worldBudget[kind];
  if (!pool) return Number.POSITIVE_INFINITY;

  let sum = 0;
  for (const n of names) {
    sum += pool[n] || 0;
  }

  return sum;
}

/**
 * Reserves resources from multiple sources in the world budget
 * 
 * Takes from sources with highest availability first
 * 
 * @param worldBudget - Current world budget
 * @param kind - Resource kind ('blocks' or 'entities')
 * @param names - Array of resource names to reserve from
 * @param amount - Amount to reserve
 * @returns Amount actually reserved
 */
export function reserveFromSources(
  worldBudget: WorldBudget | null | undefined,
  kind: ResourceKind,
  names: string[],
  amount: number
): number {
  if (!worldBudget || amount <= 0) return 0;

  const pool = worldBudget[kind];
  if (!pool) return 0;

  // Order by availability (highest first)
  const ordered = Array.from(new Set(names)).sort((a, b) => (pool[b] || 0) - (pool[a] || 0));

  let remaining = amount;
  for (const n of ordered) {
    if (remaining <= 0) break;

    const have = pool[n] || 0;
    if (have <= 0) continue;

    const take = Math.min(have, remaining);
    pool[n] = have - take;
    remaining -= take;
  }

  return amount - remaining;
}

/**
 * Accessor interface for world budget operations
 */
export interface WorldBudgetAccessors {
  can: (kind: ResourceKind, name: string, amount: number) => boolean;
  sum: (kind: ResourceKind, names: string[]) => number;
  reserve: (kind: ResourceKind, names: string[], amount: number) => number;
}

/**
 * Creates memoized accessors for world budget operations
 * 
 * @param worldBudget - World budget to wrap with accessors
 * @returns Accessor functions with memoization
 */
export function createWorldBudgetAccessors(
  worldBudget: WorldBudget | null | undefined
): WorldBudgetAccessors {
  const memoCan = new Map<string, boolean>();
  const memoSum = new Map<string, number>();

  function can(kind: ResourceKind, name: string, amount: number): boolean {
    if (!worldBudget) return true;

    const key = `${kind}|${name}|${amount}`;
    if (memoCan.has(key)) return memoCan.get(key)!;

    const ok = canConsumeWorld(worldBudget, kind, name, amount);
    memoCan.set(key, ok);
    return ok;
  }

  function sum(kind: ResourceKind, names: string[]): number {
    if (!worldBudget) return Number.POSITIVE_INFINITY;

    const uniq = Array.from(new Set(names)).sort();
    const key = `${kind}|${uniq.join(',')}`;
    if (memoSum.has(key)) return memoSum.get(key)!;

    const s = sumAvailable(worldBudget, kind, uniq);
    memoSum.set(key, s);
    return s;
  }

  function reserve(kind: ResourceKind, names: string[], amount: number): number {
    return reserveFromSources(worldBudget, kind, names, amount);
  }

  return { can, sum, reserve };
}

