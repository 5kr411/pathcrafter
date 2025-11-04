import { ReactiveBehavior, Bot } from './types';
import { ReactiveBehaviorExecutor } from '../reactive_behavior_executor';
import logger from '../../../utils/logger';

type ArmorSlot = 'head' | 'torso' | 'legs' | 'feet';

const SLOT_SUCCESS_COOLDOWN_MS = 1500;
const SLOT_RETRY_COOLDOWN_MS = 250;
const SLOT_IN_PROGRESS_COOLDOWN_MS = 250;

const slotCooldowns = new Map<ArmorSlot, number>();

function setSlotCooldown(slot: ArmorSlot, durationMs: number): void {
  slotCooldowns.set(slot, Date.now() + Math.max(0, durationMs));
}

function isSlotCooling(slot: ArmorSlot): boolean {
  const expiresAt = slotCooldowns.get(slot);
  return typeof expiresAt === 'number' && expiresAt > Date.now();
}

export function resetArmorUpgradeCooldowns(): void {
  slotCooldowns.clear();
}

interface ArmorEvaluation {
  slot: ArmorSlot;
  score: number;
}

interface ArmorUpgradeCandidate extends ArmorEvaluation {
  item: any;
  improvement: number;
}

const ARMOR_SLOTS: ArmorSlot[] = ['head', 'torso', 'legs', 'feet'];

const ARMOR_SUFFIX_TO_SLOT: Array<{ suffix: string; slot: ArmorSlot }> = [
  { suffix: '_helmet', slot: 'head' },
  { suffix: '_chestplate', slot: 'torso' },
  { suffix: '_leggings', slot: 'legs' },
  { suffix: '_boots', slot: 'feet' }
];

const ARMOR_MATERIAL_PRIORITY: Record<string, number> = {
  leather: 1,
  golden: 2,
  gold: 2,
  chainmail: 3,
  turtle: 3,
  iron: 4,
  diamond: 5,
  netherite: 6
};

function getArmorSlot(name: string): ArmorSlot | null {
  if (name === 'turtle_helmet') {
    return 'head';
  }
  for (const mapping of ARMOR_SUFFIX_TO_SLOT) {
    if (name.endsWith(mapping.suffix)) {
      return mapping.slot;
    }
  }
  return null;
}

function getArmorMaterial(name: string): string | null {
  if (name === 'turtle_helmet') {
    return 'turtle';
  }
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

function getItemMaxDurability(bot: Bot, item: any): number {
  if (!item) return 0;
  if (Number.isFinite(item.maxDurability)) {
    return item.maxDurability;
  }
  const registryEntry = (bot as any)?.registry?.items?.[item.type];
  if (registryEntry && Number.isFinite(registryEntry.maxDurability)) {
    return registryEntry.maxDurability;
  }
  return 0;
}

function evaluateArmor(bot: Bot, item: any): ArmorEvaluation | null {
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
    enchantBonus = item.enchants.reduce((total: number, enchant: any) => {
      const level = Number.isFinite(enchant?.lvl) ? enchant.lvl : 0;
      return total + level;
    }, 0) * 0.01;
  }

  const score = baseTier * 100 + durabilityRatio * 10 + enchantBonus;
  return { slot, score };
}

function getEquippedItem(bot: Bot, slot: ArmorSlot): any | null {
  if (typeof (bot as any)?.getEquipmentDestSlot !== 'function') return null;
  const index = (bot as any).getEquipmentDestSlot(slot);
  if (!Number.isInteger(index)) return null;
  const slots = (bot as any)?.inventory?.slots;
  if (!Array.isArray(slots) || index < 0 || index >= slots.length) return null;
  return slots[index] ?? null;
}

function selectArmorUpgrade(bot: Bot, slotFilter?: (slot: ArmorSlot) => boolean): ArmorUpgradeCandidate | null {
  const inventoryItems = (bot as any)?.inventory?.items?.();
  if (!Array.isArray(inventoryItems) || inventoryItems.length === 0) {
    return null;
  }

  const currentScores: Record<ArmorSlot, number> = {
    head: 0,
    torso: 0,
    legs: 0,
    feet: 0
  };

  for (const slot of ARMOR_SLOTS) {
    const equipped = getEquippedItem(bot, slot);
    if (equipped) {
      const info = evaluateArmor(bot, equipped);
      if (info) {
        currentScores[slot] = info.score;
      }
    }
  }

  let best: ArmorUpgradeCandidate | null = null;

  for (const item of inventoryItems) {
    const info = evaluateArmor(bot, item);
    if (!info) continue;
    if (slotFilter && !slotFilter(info.slot)) continue;

    const baseline = currentScores[info.slot] || 0;
    const improvement = info.score - baseline;
    if (improvement <= 0.05) {
      continue;
    }

    if (!best || improvement > best.improvement) {
      best = { slot: info.slot, score: info.score, item, improvement };
    }
  }

  return best;
}

export const armorUpgradeBehavior: ReactiveBehavior = {
  priority: 80,
  name: 'armor_upgrade',

  shouldActivate: (bot: Bot): boolean => {
    const candidate = selectArmorUpgrade(bot, (slot) => !isSlotCooling(slot));
    return candidate !== null;
  },

  execute: async (bot: Bot, executor: ReactiveBehaviorExecutor): Promise<any> => {
    const candidate = selectArmorUpgrade(bot, (slot) => !isSlotCooling(slot));
    if (!candidate) {
      executor.finish(false);
      return null;
    }

    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : null;

    const equipped = getEquippedItem(bot, candidate.slot);
    const currentScore = equipped ? evaluateArmor(bot, equipped)?.score : 0;
    logger.debug(`ArmorUpgrade: attempting upgrade slot=${candidate.slot} current=${equipped?.name || 'none'}(${currentScore}) -> target=${candidate.item.name}(${candidate.score}) improvement=${candidate.improvement}`);

    setSlotCooldown(candidate.slot, SLOT_IN_PROGRESS_COOLDOWN_MS);

    // Try direct equip approach: unequip old armor first, then equip new
    try {
      const oldArmor = getEquippedItem(bot, candidate.slot);
      if (oldArmor && typeof (bot as any)?.unequip === 'function') {
        logger.debug(`ArmorUpgrade: unequipping old armor ${oldArmor.name}`);
        await (bot as any).unequip(candidate.slot);
      }
      
      logger.debug(`ArmorUpgrade: equipping new armor ${candidate.item.name}`);
      await (bot as any).equip(candidate.item, candidate.slot);
      
      // Verify success
      setTimeout(() => {
        const nowEquipped = getEquippedItem(bot, candidate.slot);
        const success = nowEquipped?.name === candidate.item.name;
        
        logger.debug(`ArmorUpgrade: direct equip result slot=${candidate.slot} expected=${candidate.item.name} nowEquipped=${nowEquipped?.name || 'none'} success=${success}`);
        
        setSlotCooldown(candidate.slot, success ? SLOT_SUCCESS_COOLDOWN_MS : SLOT_RETRY_COOLDOWN_MS);
        if (success && sendChat) {
          sendChat(`equipped ${candidate.item.name}`);
        }
        executor.finish(success);
      }, 100);
      
      return null;
    } catch (err: any) {
      logger.debug(`ArmorUpgrade: equip error`, { error: String(err) });
      setSlotCooldown(candidate.slot, SLOT_RETRY_COOLDOWN_MS);
      executor.finish(false);
      return null;
    }
  },

  onDeactivate: () => {
  }
};


