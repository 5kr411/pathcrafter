/**
 * Armor equipment helpers shared between the reactive `armor_upgrade_behavior`
 * and the synchronous `equip_best_armor` agent tool.
 *
 * Pure evaluation logic lives here; mineflayer-side side effects (equip, unequip)
 * are still triggered by callers so the reactive state-machine flow and the
 * agent-tool flow can schedule them differently.
 */

export type ArmorSlot = 'head' | 'torso' | 'legs' | 'feet';

export const ARMOR_SLOTS: ArmorSlot[] = ['head', 'torso', 'legs', 'feet'];

export const ARMOR_SUFFIX_TO_SLOT: Array<{ suffix: string; slot: ArmorSlot }> = [
  { suffix: '_helmet', slot: 'head' },
  { suffix: '_chestplate', slot: 'torso' },
  { suffix: '_leggings', slot: 'legs' },
  { suffix: '_boots', slot: 'feet' }
];

export const ARMOR_MATERIAL_PRIORITY: Record<string, number> = {
  leather: 1,
  golden: 2,
  gold: 2,
  chainmail: 3,
  turtle: 3,
  iron: 4,
  diamond: 5,
  netherite: 6
};

export function getArmorSlot(name: string): ArmorSlot | null {
  if (name === 'turtle_helmet') return 'head';
  for (const mapping of ARMOR_SUFFIX_TO_SLOT) {
    if (name.endsWith(mapping.suffix)) return mapping.slot;
  }
  return null;
}

export function getArmorMaterial(name: string): string | null {
  if (name === 'turtle_helmet') return 'turtle';
  if (name === 'netherite_helmet') return 'netherite';
  if (name === 'netherite_chestplate') return 'netherite';
  if (name === 'netherite_leggings') return 'netherite';
  if (name === 'netherite_boots') return 'netherite';
  for (const mapping of ARMOR_SUFFIX_TO_SLOT) {
    if (name.endsWith(mapping.suffix)) {
      const prefix = name.slice(0, name.length - mapping.suffix.length);
      return prefix || null;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function getItemMaxDurability(bot: any, item: any): number {
  if (!item) return 0;
  if (Number.isFinite(item.maxDurability)) return item.maxDurability;
  const registryEntry = bot?.registry?.items?.[item.type];
  if (registryEntry && Number.isFinite(registryEntry.maxDurability)) return registryEntry.maxDurability;
  return 0;
}

export interface ArmorEvaluation { slot: ArmorSlot; score: number; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function evaluateArmor(bot: any, item: any): ArmorEvaluation | null {
  if (!item || !item.name) return null;
  const slot = getArmorSlot(item.name);
  if (!slot) return null;
  const material = getArmorMaterial(item.name);
  if (!material) return null;
  const baseTier = ARMOR_MATERIAL_PRIORITY[material] ?? 0;
  if (baseTier <= 0) return null;

  const maxDurability = getItemMaxDurability(bot, item);
  const durabilityUsed = Math.max(0, item.durabilityUsed || 0);
  let durabilityRatio = 1;
  if (maxDurability > 0) {
    const remaining = Math.max(0, maxDurability - durabilityUsed);
    durabilityRatio = remaining / maxDurability;
  }

  let enchantBonus = 0;
  if (Array.isArray(item.enchants)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    enchantBonus = item.enchants.reduce((total: number, enchant: any) => {
      const level = Number.isFinite(enchant?.lvl) ? enchant.lvl : 0;
      return total + level;
    }, 0) * 0.01;
  }

  const score = baseTier * 100 + durabilityRatio * 10 + enchantBonus;
  return { slot, score };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function getEquippedArmor(bot: any, slot: ArmorSlot): any | null {
  if (typeof bot?.getEquipmentDestSlot !== 'function') return null;
  const index = bot.getEquipmentDestSlot(slot);
  if (!Number.isInteger(index)) return null;
  const slots = bot?.inventory?.slots;
  if (!Array.isArray(slots) || index < 0 || index >= slots.length) return null;
  return slots[index] ?? null;
}

export interface ArmorUpgradeCandidate extends ArmorEvaluation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
  item: any;
  improvement: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function selectArmorUpgrade(bot: any, slotFilter?: (slot: ArmorSlot) => boolean): ArmorUpgradeCandidate | null {
  const inventoryItems = bot?.inventory?.items?.();
  if (!Array.isArray(inventoryItems) || inventoryItems.length === 0) return null;

  const currentScores: Record<ArmorSlot, number> = { head: 0, torso: 0, legs: 0, feet: 0 };
  for (const slot of ARMOR_SLOTS) {
    const equipped = getEquippedArmor(bot, slot);
    if (equipped) {
      const info = evaluateArmor(bot, equipped);
      if (info) currentScores[slot] = info.score;
    }
  }

  let best: ArmorUpgradeCandidate | null = null;
  for (const item of inventoryItems) {
    const info = evaluateArmor(bot, item);
    if (!info) continue;
    if (slotFilter && !slotFilter(info.slot)) continue;
    const baseline = currentScores[info.slot] || 0;
    const improvement = info.score - baseline;
    if (improvement <= 0.05) continue;
    if (!best || improvement > best.improvement) {
      best = { slot: info.slot, score: info.score, item, improvement };
    }
  }
  return best;
}

/**
 * Pick the best armor item per slot from the bot's inventory, ignoring what is
 * currently equipped. Used by the agent tool to equip a fresh loadout in a
 * single tool call — the reactive behavior uses `selectArmorUpgrade` instead,
 * which only replaces strictly better items.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export function pickBestArmorPerSlot(bot: any): Record<ArmorSlot, any | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
  const out: Record<ArmorSlot, any | null> = { head: null, torso: null, legs: null, feet: null };
  const bestScore: Record<ArmorSlot, number> = { head: -Infinity, torso: -Infinity, legs: -Infinity, feet: -Infinity };
  const items = bot?.inventory?.items?.();
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const info = evaluateArmor(bot, item);
    if (!info) continue;
    if (info.score > bestScore[info.slot]) {
      bestScore[info.slot] = info.score;
      out[info.slot] = item;
    }
  }
  return out;
}

/**
 * Equip the best armor per slot, returning the list of item names that were
 * equipped. Skips slots where the currently-equipped item is already the best.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
export async function equipBestArmor(bot: any): Promise<string[]> {
  const equipped: string[] = [];
  const picks = pickBestArmorPerSlot(bot);
  for (const slot of ARMOR_SLOTS) {
    const pick = picks[slot];
    if (!pick) continue;
    const current = getEquippedArmor(bot, slot);
    if (current && current.name === pick.name) continue;
    try {
      if (current && typeof bot.unequip === 'function') {
        try { await bot.unequip(slot); } catch (_) {}
      }
      if (typeof bot.equip === 'function') {
        await bot.equip(pick, slot);
        equipped.push(pick.name);
      }
    } catch (_) {}
  }
  return equipped;
}
