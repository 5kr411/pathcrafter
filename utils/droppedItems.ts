export interface DroppedItemInfo {
  name: string | null;
  count: number;
}

export interface MinecraftDataLike {
  items?: Array<{ name?: string }>;
}

export function getDroppedItemInfo(entity: any, mcData?: MinecraftDataLike): DroppedItemInfo {
  try {
    if (entity && typeof entity.getDroppedItem === 'function') {
      const dropped = entity.getDroppedItem();
      if (dropped) {
        return {
          name: dropped.name || null,
          count: Number(dropped.count || 1) || 1
        };
      }
    }
  } catch (_) {
    // Ignore and fall back to metadata parsing
  }

  try {
    const meta = Array.isArray(entity?.metadata) ? (entity.metadata[7] || entity.metadata[8]) : null;
    if (meta && typeof meta === 'object' && meta.itemId !== undefined) {
      const itemId = Number(meta.itemId);
      const nameFromMeta = typeof meta.name === 'string' ? meta.name : null;
      const nameFromMc = Number.isFinite(itemId) ? mcData?.items?.[itemId]?.name : undefined;
      const name = nameFromMeta || nameFromMc || (Number.isFinite(itemId) ? `item_${itemId}` : null);
      const count = Number(meta.itemCount || meta.count || 1) || 1;
      return { name, count };
    }
  } catch (_) {
    // Ignore metadata parsing errors
  }

  return { name: null, count: 0 };
}
