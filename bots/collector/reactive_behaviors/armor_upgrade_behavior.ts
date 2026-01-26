import { BehaviorIdle, NestedStateMachine, StateBehavior, StateTransition } from 'mineflayer-statemachine';
import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import logger from '../../../utils/logger';

type ArmorSlot = 'head' | 'torso' | 'legs' | 'feet';
type EquipSlot = ArmorSlot | 'off-hand';

const SLOT_SUCCESS_COOLDOWN_MS = 1500;
const SLOT_RETRY_COOLDOWN_MS = 250;
const SLOT_IN_PROGRESS_COOLDOWN_MS = 250;

const slotCooldowns = new Map<EquipSlot, number>();

function setSlotCooldown(slot: EquipSlot, durationMs: number): void {
  slotCooldowns.set(slot, Date.now() + Math.max(0, durationMs));
}

function isSlotCooling(slot: EquipSlot): boolean {
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

function getOffhandItem(bot: Bot): any | null {
  try {
    if (typeof (bot as any)?.getEquipmentDestSlot !== 'function') {
      return null;
    }
    const offHandIndex = (bot as any).getEquipmentDestSlot('off-hand');
    const slots = (bot as any)?.inventory?.slots;
    if (!Array.isArray(slots) || !Number.isInteger(offHandIndex) || offHandIndex < 0 || offHandIndex >= slots.length) {
      return null;
    }
    return slots[offHandIndex] ?? null;
  } catch (err: any) {
    logger.debug(`ArmorUpgrade: unable to read off-hand slot - ${err?.message || err}`);
    return null;
  }
}

function isShieldItem(item: any): boolean {
  if (!item || typeof item.name !== 'string') {
    return false;
  }
  return item.name.toLowerCase() === 'shield';
}

function hasShieldInOffhand(bot: Bot): boolean {
  return isShieldItem(getOffhandItem(bot));
}

function findShieldInInventory(bot: Bot): any | null {
  const inventoryItems = (bot as any)?.inventory?.items?.();
  if (!Array.isArray(inventoryItems)) {
    return null;
  }

  for (const item of inventoryItems) {
    if (isShieldItem(item)) {
      return item;
    }
  }
  return null;
}

function shouldEquipShield(bot: Bot): any | null {
  if (hasShieldInOffhand(bot)) {
    return null;
  }
  return findShieldInInventory(bot);
}

interface EquipAttempt {
  slot: EquipSlot;
  item: any;
  label: string;
}

class BehaviorEquipSlot implements StateBehavior {
  public stateName = 'EquipSlot';
  public active = false;
  private finished = false;
  private success = false;
  private verifyTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly bot: Bot,
    private readonly attempt: EquipAttempt,
    private readonly sendChat: ((msg: string) => void) | null,
    private readonly verify: () => boolean
  ) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    this.success = false;
    this.startEquip();
  }

  onStateExited(): void {
    this.active = false;
    this.clearTimer();
  }

  isFinished(): boolean {
    return this.finished;
  }

  wasSuccessful(): boolean {
    return this.success;
  }

  markPreempted(): void {
    if (!this.finished) {
      setSlotCooldown(this.attempt.slot, SLOT_RETRY_COOLDOWN_MS);
      this.clearTimer();
      this.finished = true;
      this.success = false;
    }
  }

  private clearTimer(): void {
    if (this.verifyTimer) {
      clearTimeout(this.verifyTimer);
      this.verifyTimer = null;
    }
  }

  private finish(success: boolean): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.success = success;
    setSlotCooldown(this.attempt.slot, success ? SLOT_SUCCESS_COOLDOWN_MS : SLOT_RETRY_COOLDOWN_MS);
    if (success && this.sendChat) {
      this.sendChat(`equipped ${this.attempt.label}`);
    }
  }

  private async startEquip(): Promise<void> {
    setSlotCooldown(this.attempt.slot, SLOT_IN_PROGRESS_COOLDOWN_MS);

    try {
      if (this.attempt.slot !== 'off-hand') {
        const oldArmor = getEquippedItem(this.bot, this.attempt.slot as ArmorSlot);
        if (oldArmor && typeof (this.bot as any)?.unequip === 'function') {
          logger.debug(`ArmorUpgrade: unequipping old armor ${oldArmor.name}`);
          await (this.bot as any).unequip(this.attempt.slot);
        }
      }

      logger.debug(`ArmorUpgrade: equipping ${this.attempt.item.name} to ${this.attempt.slot}`);
      await (this.bot as any).equip(this.attempt.item, this.attempt.slot);

      this.verifyTimer = setTimeout(() => {
        const success = this.verify();
        logger.debug(`ArmorUpgrade: equip verification slot=${this.attempt.slot} success=${success}`);
        this.finish(success);
      }, 100);
    } catch (err: any) {
      logger.debug('ArmorUpgrade: equip error', { error: String(err) });
      this.finish(false);
    }
  }
}

function createEquipState(
  bot: Bot,
  attempt: EquipAttempt,
  sendChat: ((msg: string) => void) | null,
  verify: () => boolean
): {
  stateMachine: any;
  wasSuccessful: () => boolean;
  onStop: (reason: ReactiveBehaviorStopReason) => void;
} {
  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();
  const equip = new BehaviorEquipSlot(bot, attempt, sendChat, verify);

  const enterToEquip = new StateTransition({
    parent: enter,
    child: equip,
    name: 'armor-upgrade: enter -> equip',
    shouldTransition: () => true
  });

  const equipToExit = new StateTransition({
    parent: equip,
    child: exit,
    name: 'armor-upgrade: equip -> exit',
    shouldTransition: () => equip.isFinished()
  });

  const stateMachine = new NestedStateMachine([enterToEquip, equipToExit], enter, exit);

  return {
    stateMachine,
    wasSuccessful: () => equip.wasSuccessful(),
    onStop: (reason: ReactiveBehaviorStopReason) => {
      if (reason !== 'completed') {
        equip.markPreempted();
      }
    }
  };
}

export const armorUpgradeBehavior: ReactiveBehavior = {
  priority: 80,
  name: 'armor_upgrade',

  shouldActivate: (bot: Bot): boolean => {
    const armorCandidate = selectArmorUpgrade(bot, (slot) => !isSlotCooling(slot));
    if (armorCandidate !== null) {
      return true;
    }

    if (!isSlotCooling('off-hand')) {
      const shieldItem = shouldEquipShield(bot);
      if (shieldItem !== null) {
        return true;
      }
    }

    return false;
  },

  createState: async (bot: Bot): Promise<any> => {
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      ? (bot as any).safeChat.bind(bot)
      : null;

    const armorCandidate = selectArmorUpgrade(bot, (slot) => !isSlotCooling(slot));
    if (armorCandidate) {
      const equipped = getEquippedItem(bot, armorCandidate.slot);
      const currentScore = equipped ? evaluateArmor(bot, equipped)?.score : 0;
      logger.debug(`ArmorUpgrade: attempting upgrade slot=${armorCandidate.slot} current=${equipped?.name || 'none'}(${currentScore}) -> target=${armorCandidate.item.name}(${armorCandidate.score}) improvement=${armorCandidate.improvement}`);

      const attempt: EquipAttempt = {
        slot: armorCandidate.slot,
        item: armorCandidate.item,
        label: armorCandidate.item.name
      };

      const verify = () => {
        const nowEquipped = getEquippedItem(bot, armorCandidate.slot);
        return nowEquipped?.name === armorCandidate.item.name;
      };

      return createEquipState(bot, attempt, sendChat, verify);
    }

    if (!isSlotCooling('off-hand')) {
      const shieldItem = shouldEquipShield(bot);
      if (shieldItem) {
        logger.debug(`ArmorUpgrade: attempting to equip shield in off-hand`);
        const attempt: EquipAttempt = {
          slot: 'off-hand',
          item: shieldItem,
          label: 'shield'
        };

        const verify = () => hasShieldInOffhand(bot);
        return createEquipState(bot, attempt, sendChat, verify);
      }
    }

    return null;
  }
};

