import { DroppedItemInfo, getDroppedItemInfo, MinecraftDataLike } from '../utils/droppedItems';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
}

export interface MinecraftDataWithBlocks extends MinecraftDataLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  entity: any;
  botPos?: Vec3Like | null;
  targetPos?: Vec3Like | null;
  mcData?: MinecraftDataLike;
  dropCollectRadius: number;
  botRange: number;
  targetItemName?: string | null;
}): { ok: boolean; dropInfo: DroppedItemInfo; distToTarget: number } {
  const { entity, botPos, targetPos, mcData, dropCollectRadius, botRange, targetItemName } = params;

  if (!botPos || !entity?.position?.distanceTo) {
    return { ok: false, dropInfo: { name: null, count: 0 }, distToTarget: Number.POSITIVE_INFINITY };
  }

  const dropInfo = getDroppedItemInfo(entity, mcData);
  const isItem = entity.displayName === 'Item' || entity.name === 'item' || !!dropInfo.name;
  if (!isItem) {
    return { ok: false, dropInfo, distToTarget: Number.POSITIVE_INFINITY };
  }

  // If we know the target item and the drop name, skip non-matching drops
  if (targetItemName && dropInfo.name && dropInfo.name !== targetItemName) {
    return { ok: false, dropInfo, distToTarget: Number.POSITIVE_INFINITY };
  }

  const distToTarget =
    targetPos && entity.position.distanceTo ? entity.position.distanceTo(targetPos) : Number.POSITIVE_INFINITY;
  const nearTarget = distToTarget < dropCollectRadius;
  const inBotRange = entity.position.distanceTo(botPos) < botRange;

  return { ok: nearTarget && inBotRange, dropInfo, distToTarget };
}
