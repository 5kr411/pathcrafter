import { DroppedItemInfo, getDroppedItemInfo, MinecraftDataLike } from '../utils/droppedItems';
import { HUNTABLE_ANIMALS } from '../utils/foodConfig';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
}

export interface BotLike {
  entity?: { position?: Vec3Like };
  entities?: Record<string, any>;
}

export interface HuntableAnimal {
  entity: string;
  drops: string[];
}

export function findClosestHuntableAnimal(
  bot: BotLike,
  filter?: string[],
  animals: HuntableAnimal[] = HUNTABLE_ANIMALS as HuntableAnimal[]
): { entity: any; animalType: string } | null {
  if (!bot.entities || !bot.entity?.position) return null;

  const validAnimals = filter?.length
    ? animals.filter((a) => filter.includes(a.entity))
    : animals;

  const animalNames = new Set(validAnimals.map((a) => a.entity));

  let closest: any = null;
  let closestDist = Infinity;
  let closestType = '';

  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position) continue;
    const name = (entity.name || '').toLowerCase();

    if (!animalNames.has(name)) continue;

    if (typeof entity.isAlive === 'function' && !entity.isAlive()) continue;
    if (typeof entity.health === 'number' && entity.health <= 0) continue;

    const dist = bot.entity.position.distanceTo!(entity.position);
    if (dist < closestDist) {
      closest = entity;
      closestDist = dist;
      closestType = name;
    }
  }

  return closest ? { entity: closest, animalType: closestType } : null;
}

export function getRawMeatDrop(
  animalType: string,
  animals: HuntableAnimal[] = HUNTABLE_ANIMALS as HuntableAnimal[]
): string | null {
  const animal = animals.find((a) => a.entity === animalType);
  return animal?.drops[0] || null;
}

export function countRawMeatInInventory(
  inventory: Record<string, number>,
  animals: HuntableAnimal[] = HUNTABLE_ANIMALS as HuntableAnimal[]
): { rawItem: string; count: number }[] {
  const rawMeats: { rawItem: string; count: number }[] = [];

  for (const animal of animals) {
    const rawItem = animal.drops[0];
    const count = inventory[rawItem] || 0;
    if (count > 0) {
      rawMeats.push({ rawItem, count });
    }
  }

  return rawMeats;
}

export function isActualDroppedItem(entity: any): boolean {
  if (entity.name === 'item') return true;
  if (typeof entity.getDroppedItem === 'function' && entity.getDroppedItem()) return true;
  return false;
}

export function evaluateHuntDropCandidate(params: {
  entity: any;
  botPos?: Vec3Like | null;
  killPosition?: Vec3Like | null;
  attemptedDropIds?: Set<number>;
  dropCollectRadius: number;
  botRange: number;
  mcData?: MinecraftDataLike;
}): { ok: boolean; dropInfo: DroppedItemInfo; distToKill: number } {
  const { entity, botPos, killPosition, attemptedDropIds, dropCollectRadius, botRange, mcData } = params;

  if (!botPos || !entity?.position?.distanceTo) {
    return { ok: false, dropInfo: { name: null, count: 0 }, distToKill: Number.POSITIVE_INFINITY };
  }

  if (entity.id && attemptedDropIds?.has(entity.id)) {
    return { ok: false, dropInfo: { name: null, count: 0 }, distToKill: Number.POSITIVE_INFINITY };
  }

  if (!isActualDroppedItem(entity)) {
    return { ok: false, dropInfo: { name: null, count: 0 }, distToKill: Number.POSITIVE_INFINITY };
  }

  const distToKill =
    killPosition && entity.position.distanceTo ? entity.position.distanceTo(killPosition) : Number.POSITIVE_INFINITY;
  const nearKillPos = distToKill < dropCollectRadius;
  const inBotRange = entity.position.distanceTo(botPos) < botRange;

  if (!nearKillPos || !inBotRange) {
    return { ok: false, dropInfo: { name: null, count: 0 }, distToKill };
  }

  const dropInfo = getDroppedItemInfo(entity, mcData);
  return { ok: true, dropInfo, distToKill };
}

export function isDropCollectTimedOut(startTime: number, now: number, timeoutMs: number): boolean {
  return now - startTime > timeoutMs;
}

export function hasSwordInInventory(inventory: Record<string, number>): boolean {
  return Object.entries(inventory).some(([name, count]) => {
    if (!name.endsWith('_sword')) return false;
    return (count || 0) > 0;
  });
}
