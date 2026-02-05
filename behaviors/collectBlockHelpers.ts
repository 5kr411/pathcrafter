import { DroppedItemInfo, getDroppedItemInfo, MinecraftDataLike } from '../utils/droppedItems';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
}

export interface MinecraftDataWithBlocks extends MinecraftDataLike {
  blocksByName?: Record<string, { harvestTools?: Record<string, any> }>;
  items?: Array<{ name?: string }>;
}

export function inventoryItemsToMap(items?: Array<{ name?: string; count?: number }> | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!items) return out;

  for (const item of items) {
    if (!item || !item.name) continue;
    const count = Number.isFinite(item.count) ? item.count! : 1;
    if (!count || count <= 0) continue;
    out.set(item.name, (out.get(item.name) || 0) + count);
  }

  return out;
}

export function getHarvestToolNames(
  block: { harvestTools?: Record<string, any> } | null | undefined,
  mcData: MinecraftDataWithBlocks,
  fallbackName?: string
): string[] {
  const harvestTools =
    block?.harvestTools ||
    (fallbackName ? mcData.blocksByName?.[fallbackName]?.harvestTools : undefined);
  if (!harvestTools) return [];

  return Object.keys(harvestTools)
    .map((id) => {
      const toolId = Number(id);
      return mcData.items?.[toolId]?.name;
    })
    .filter((n): n is string => !!n);
}

export function isDropEntityCandidate(params: {
  entity: any;
  botPos?: Vec3Like | null;
  targetPos?: Vec3Like | null;
  mcData?: MinecraftDataLike;
  dropCollectRadius: number;
  botRange: number;
}): { ok: boolean; dropInfo: DroppedItemInfo; distToTarget: number } {
  const { entity, botPos, targetPos, mcData, dropCollectRadius, botRange } = params;

  if (!botPos || !entity?.position?.distanceTo) {
    return { ok: false, dropInfo: { name: null, count: 0 }, distToTarget: Number.POSITIVE_INFINITY };
  }

  const dropInfo = getDroppedItemInfo(entity, mcData);
  const isItem = entity.displayName === 'Item' || entity.name === 'item' || !!dropInfo.name;
  if (!isItem) {
    return { ok: false, dropInfo, distToTarget: Number.POSITIVE_INFINITY };
  }

  const distToTarget =
    targetPos && entity.position.distanceTo ? entity.position.distanceTo(targetPos) : Number.POSITIVE_INFINITY;
  const nearTarget = distToTarget < dropCollectRadius;
  const inBotRange = entity.position.distanceTo(botPos) < botRange;

  return { ok: nearTarget && inBotRange, dropInfo, distToTarget };
}
