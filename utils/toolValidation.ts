export function getToolRemainingUses(bot: any, item: any): number {
  if (!item || typeof item.type !== 'number') {
    return 0;
  }

  try {
    const itemData = bot.registry?.items?.[item.type];
    if (!itemData) {
      return 0;
    }

    const maxDurability = itemData.maxDurability;
    if (!maxDurability || !Number.isFinite(maxDurability)) {
      return 0;
    }

    const durabilityUsed = item.durabilityUsed || 0;
    const remaining = maxDurability - durabilityUsed;
    
    return Math.max(0, remaining);
  } catch (_) {
    return 0;
  }
}
