import { BehaviorIdle, NestedStateMachine, StateBehavior, StateTransition } from 'mineflayer-statemachine';
import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import logger from '../../../utils/logger';
import { isWorkstationLocked } from '../../../utils/workstationLock';
import {
  ArmorSlot,
  evaluateArmor,
  getEquippedArmor as getEquippedItem,
  selectArmorUpgrade
} from '../../agent_bot/tools/impl/helpers/armor';

type EquipSlot = ArmorSlot | 'off-hand';

const SLOT_COOLDOWN_MS = 1500;

let lastEquipTime = 0;

function setSlotCooldown(): void {
  lastEquipTime = Date.now();
}

function isSlotCooling(): boolean {
  if (lastEquipTime === 0) return false;
  return Date.now() - lastEquipTime < SLOT_COOLDOWN_MS;
}

export function resetArmorUpgradeCooldowns(): void {
  lastEquipTime = 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function getOffhandItem(bot: Bot): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  if (typeof (bot as any)?.getEquipmentDestSlot !== 'function') {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const offHandIndex = (bot as any).getEquipmentDestSlot('off-hand');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const slots = (bot as any)?.inventory?.slots;
  if (!Array.isArray(slots) || !Number.isInteger(offHandIndex) || offHandIndex < 0 || offHandIndex >= slots.length) {
    return null;
  }
  return slots[offHandIndex] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function isShieldItem(item: any): boolean {
  if (!item || typeof item.name !== 'string') {
    return false;
  }
  return item.name.toLowerCase() === 'shield';
}

function hasShieldInOffhand(bot: Bot): boolean {
  return isShieldItem(getOffhandItem(bot));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function findShieldInInventory(bot: Bot): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function shouldEquipShield(bot: Bot): any | null {
  if (hasShieldInOffhand(bot)) {
    return null;
  }
  return findShieldInInventory(bot);
}

interface EquipAttempt {
  slot: EquipSlot;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
      setSlotCooldown();
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
    setSlotCooldown();
    if (success && this.sendChat) {
      this.sendChat(`equipped ${this.attempt.label}`);
    }
  }

  private async startEquip(): Promise<void> {
    setSlotCooldown();

    try {
      if (this.attempt.slot !== 'off-hand') {
        const oldArmor = getEquippedItem(this.bot, this.attempt.slot as ArmorSlot);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        if (oldArmor && typeof (this.bot as any)?.unequip === 'function') {
          logger.debug(`ArmorUpgrade: unequipping old armor ${oldArmor.name}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
          await (this.bot as any).unequip(this.attempt.slot);
        }
      }

      logger.debug(`ArmorUpgrade: equipping ${this.attempt.item.name} to ${this.attempt.slot}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      await (this.bot as any).equip(this.attempt.item, this.attempt.slot);

      this.verifyTimer = setTimeout(() => {
        const success = this.verify();
        logger.debug(`ArmorUpgrade: equip verification slot=${this.attempt.slot} success=${success}`);
        this.finish(success);
      }, 100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
    if (isWorkstationLocked()) return false;

    const armorCandidate = selectArmorUpgrade(bot, () => !isSlotCooling());
    if (armorCandidate !== null) {
      return true;
    }

    if (!isSlotCooling()) {
      const shieldItem = shouldEquipShield(bot);
      if (shieldItem !== null) {
        return true;
      }
    }

    return false;
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  createState: async (bot: Bot): Promise<any> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const sendChat: ((msg: string) => void) | null = typeof (bot as any)?.safeChat === 'function'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      ? (bot as any).safeChat.bind(bot)
      : null;

    const armorCandidate = selectArmorUpgrade(bot, () => !isSlotCooling());
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

    if (!isSlotCooling()) {
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

