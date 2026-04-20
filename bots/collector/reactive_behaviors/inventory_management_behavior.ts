import { BehaviorIdle, NestedStateMachine, StateBehavior, StateTransition } from 'mineflayer-statemachine';
import { Vec3 } from 'vec3';
import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import { getEmptySlotCount } from '../../../utils/inventory';
import { isFood } from '../../../utils/foodConfig';
import { isWorkstation, isTool } from '../../../utils/persistentItemsConfig';
import { rank, getSuffixTokenFromName } from '../../../utils/items';
import logger from '../../../utils/logger';

const INVENTORY_MANAGEMENT_PRIORITY = 30;
const TOSS_DELAY_MS = 300;
const TOSS_PITCH = -0.3; // ~17 degrees above horizontal so items fly farther
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000;
const FREE_SLOT_BUFFER = 2;

export interface InventoryManagementConfig {
  reactiveThreshold: number;
  preGateThreshold: number;
  cooldownMs: number;
  /** @deprecated alias for reactiveThreshold; accepted in setInventoryManagementConfig only */
  triggerFreeSlots?: number;
  getTargets: () => Array<{ item: string; count: number }>;
}

const DEFAULT_CONFIG: InventoryManagementConfig = {
  reactiveThreshold: 3,
  preGateThreshold: 2,
  cooldownMs: 30_000,
  getTargets: () => []
};

let config: InventoryManagementConfig = { ...DEFAULT_CONFIG };
let lastManagementTime = 0;
let lastShouldActivateLogTime = 0;

export function setInventoryManagementConfig(partial: Partial<InventoryManagementConfig>): void {
  const { triggerFreeSlots, ...rest } = partial;
  if (triggerFreeSlots !== undefined) {
    config = { ...config, reactiveThreshold: triggerFreeSlots, ...rest };
  } else {
    config = { ...config, ...rest };
  }
}

export function getInventoryManagementConfig(): InventoryManagementConfig {
  return { ...config };
}

export function resetInventoryManagementCooldown(): void {
  lastManagementTime = 0;
}

export function triggerInventoryManagementCooldown(): void {
  lastManagementTime = Date.now() || 1;
}

function isInCooldown(): boolean {
  if (lastManagementTime === 0) return false;
  return Date.now() - lastManagementTime < config.cooldownMs;
}

// --- Item protection ---

function isProtectedItem(_bot: Bot, itemName: string): boolean {
  if (isFood(itemName)) return true;
  if (isWorkstation(itemName)) return true;
  return false;
}

function getProtectedQuantity(itemName: string): number {
  if (isFood(itemName)) return Infinity;
  if (isWorkstation(itemName)) return Infinity;
  try {
    const targets = config.getTargets?.() ?? [];
    let total = 0;
    for (const t of targets) {
      if (t?.item === itemName) total += t.count || 0;
    }
    return total;
  } catch (_) {
    return 0;
  }
}

// --- Drop candidate logic ---

export interface DropCandidate {
  item: any;
  reason: 'lower_tier_tool' | 'duplicate_stack' | 'excess_over_target';
}

function getMainInventoryItems(bot: Bot): any[] {
  const slots = (bot as any)?.inventory?.slots;
  if (!Array.isArray(slots)) return [];

  const items: any[] = [];
  for (let i = 9; i <= 44; i++) {
    const item = slots[i];
    if (item && item.name) items.push(item);
  }
  return items;
}

export function calculateItemsToDrop(bot: Bot, targetFreeSlots: number): DropCandidate[] {
  const currentFree = getEmptySlotCount(bot as any);
  const slotsToFree = targetFreeSlots - currentFree;
  if (slotsToFree <= 0) return [];

  const items = getMainInventoryItems(bot);
  const candidates: DropCandidate[] = [];
  const addedItems = new Set<any>();

  // Group items by name once; used by Phase 0 and for held-vs-protected checks.
  const byName = new Map<string, any[]>();
  for (const item of items) {
    const arr = byName.get(item.name) || [];
    arr.push(item);
    byName.set(item.name, arr);
  }

  // Phase 0: excess over target
  for (const [name, stacks] of byName) {
    const protectedQty = getProtectedQuantity(name);
    if (protectedQty === Infinity) continue;
    if (protectedQty <= 0) continue; // no target → Phase 0 does not apply
    const held = stacks.reduce((s: number, it: any) => s + (it.count || 0), 0);
    let excess = held - protectedQty;
    if (excess <= 0) continue;
    // Smallest stacks first so we preserve large near-target stacks.
    const sorted = stacks.slice().sort((a: any, b: any) => (a.count || 0) - (b.count || 0));
    for (const stack of sorted) {
      if (excess <= 0) break;
      if ((stack.count || 0) > excess) continue; // whole-stack only
      if (addedItems.has(stack)) continue;
      candidates.push({ item: stack, reason: 'excess_over_target' });
      addedItems.add(stack);
      excess -= stack.count || 0;
      if (candidates.length >= slotsToFree) return candidates;
    }
  }

  // Helper: whether an item should be skipped by Phase 1/2 because its total
  // held count does not exceed the protected (target + food/workstation) amount.
  const heldExceedsProtected = (itemName: string): boolean => {
    const protectedQty = getProtectedQuantity(itemName);
    if (protectedQty === Infinity) return false;
    if (protectedQty <= 0) return true;
    const stacks = byName.get(itemName) || [];
    const held = stacks.reduce((s: number, it: any) => s + (it.count || 0), 0);
    return held > protectedQty;
  };

  // Phase 1: lower-tier duplicate tools
  const toolGroups = new Map<string, any[]>();
  for (const item of items) {
    if (!isTool(item.name)) continue;
    if (isProtectedItem(bot, item.name)) continue;
    if (!heldExceedsProtected(item.name)) continue;
    const suffix = getSuffixTokenFromName(item.name);
    const group = toolGroups.get(suffix) || [];
    group.push(item);
    toolGroups.set(suffix, group);
  }

  for (const [, tools] of toolGroups) {
    if (tools.length < 2) continue;

    const tiers = new Set(tools.map((t: any) => rank(t.name)));
    if (tiers.size < 2) continue;

    tools.sort((a: any, b: any) => rank(b.name) - rank(a.name));
    const bestRank = rank(tools[0].name);

    for (let i = 1; i < tools.length; i++) {
      if (rank(tools[i].name) >= bestRank) continue;
      if (addedItems.has(tools[i])) continue;
      candidates.push({ item: tools[i], reason: 'lower_tier_tool' });
      addedItems.add(tools[i]);
      if (candidates.length >= slotsToFree) return candidates;
    }
  }

  // Phase 2: duplicate stacks (smallest first)
  const stackGroups = new Map<string, any[]>();
  for (const item of items) {
    if (isProtectedItem(bot, item.name)) continue;
    if (!heldExceedsProtected(item.name)) continue;
    if (addedItems.has(item)) continue;
    const group = stackGroups.get(item.name) || [];
    group.push(item);
    stackGroups.set(item.name, group);
  }

  const dupeStacks: any[] = [];
  for (const [, stacks] of stackGroups) {
    if (stacks.length < 2) continue;
    stacks.sort((a: any, b: any) => (a.count || 0) - (b.count || 0));
    for (let i = 0; i < stacks.length - 1; i++) {
      dupeStacks.push(stacks[i]);
    }
  }

  dupeStacks.sort((a: any, b: any) => (a.count || 0) - (b.count || 0));

  for (const item of dupeStacks) {
    if (addedItems.has(item)) continue;
    candidates.push({ item, reason: 'duplicate_stack' });
    addedItems.add(item);
    if (candidates.length >= slotsToFree) return candidates;
  }

  return candidates;
}

// --- Direction finding ---

function findClearDirection(bot: Bot): number {
  const currentYaw = (bot as any)?.entity?.yaw ?? 0;
  const behindYaw = currentYaw + Math.PI;

  if (!bot.entity?.position || typeof (bot as any).blockAt !== 'function') {
    return behindYaw;
  }

  const candidates = [
    behindYaw,
    behindYaw + Math.PI / 2,
    behindYaw - Math.PI / 2,
    currentYaw
  ];

  for (const yaw of candidates) {
    if (isDirectionClear(bot, yaw)) return yaw;
  }

  return behindYaw;
}

function isDirectionClear(bot: Bot, yaw: number): boolean {
  const pos = bot.entity?.position;
  if (!pos) return true;

  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);

  for (let dist = 1; dist <= 3; dist++) {
    const x = Math.floor(pos.x + dx * dist);
    const y = Math.floor(pos.y + 1);
    const z = Math.floor(pos.z + dz * dist);

    const block = (bot as any).blockAt(new Vec3(x, y, z));
    if (block && block.boundingBox !== 'empty') return false;
  }
  return true;
}

// --- State machine ---

class BehaviorTossItems implements StateBehavior {
  public stateName = 'TossItems';
  public active = false;
  private finished = false;
  private success = false;
  private droppedCount = 0;

  constructor(
    private readonly bot: Bot,
    private readonly candidates: DropCandidate[],
    private readonly sendChat: ((msg: string) => void) | null
  ) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    this.success = false;
    this.droppedCount = 0;
    this.executeTossSequence();
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean {
    return this.finished;
  }

  wasSuccessful(): boolean {
    return this.success;
  }

  private async executeTossSequence(): Promise<void> {
    try {
      const tossYaw = findClearDirection(this.bot);
      const originalYaw = (this.bot as any)?.entity?.yaw ?? 0;
      const originalPitch = (this.bot as any)?.entity?.pitch ?? 0;

      if (typeof (this.bot as any)?.look === 'function') {
        await (this.bot as any).look(tossYaw, TOSS_PITCH);
      }

      for (const candidate of this.candidates) {
        if (!this.active) break;

        try {
          logger.debug(
            `InventoryManagement: dropping ${candidate.item.name} x${candidate.item.count} (${candidate.reason})`
          );

          if (typeof (this.bot as any)?.tossStack === 'function') {
            await (this.bot as any).tossStack(candidate.item);
          } else if (typeof (this.bot as any)?.toss === 'function') {
            await (this.bot as any).toss(candidate.item.type, null, candidate.item.count);
          }

          this.droppedCount++;

          if (this.active && this.candidates.indexOf(candidate) < this.candidates.length - 1) {
            await new Promise(resolve => setTimeout(resolve, TOSS_DELAY_MS));
          }
        } catch (err: any) {
          logger.debug(
            `InventoryManagement: failed to drop ${candidate.item.name} - ${err?.message || err}`
          );
        }
      }

      if (typeof (this.bot as any)?.look === 'function') {
        try {
          await (this.bot as any).look(originalYaw, originalPitch);
        } catch (_) {}
      }

      this.success = this.droppedCount > 0;

      if (this.success) {
        logger.info(`InventoryManagement: dropped ${this.droppedCount} item(s)`);
        if (this.sendChat) {
          this.sendChat(`dropped ${this.droppedCount} item(s) to free inventory space`);
        }
      }
    } catch (err: any) {
      logger.info(`InventoryManagement: toss sequence failed - ${err?.message || err}`);
    } finally {
      this.finished = true;
    }
  }
}

// --- Behavior export ---

export const inventoryManagementBehavior: ReactiveBehavior = {
  priority: INVENTORY_MANAGEMENT_PRIORITY,
  name: 'inventory_management',

  shouldActivate: (bot: Bot): boolean => {
    const freeSlots = getEmptySlotCount(bot as any);
    const now = Date.now();

    if (freeSlots > config.reactiveThreshold) return false;

    if (isInCooldown()) {
      if (now - lastShouldActivateLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
        const remaining = Math.ceil((config.cooldownMs - (now - lastManagementTime)) / 1000);
        logger.debug(`InventoryManagement: in cooldown (${remaining}s remaining)`);
        lastShouldActivateLogTime = now;
      }
      return false;
    }

    if (now - lastShouldActivateLogTime >= SHOULD_ACTIVATE_LOG_INTERVAL_MS) {
      logger.debug(
        `InventoryManagement: should activate - freeSlots=${freeSlots} <= threshold=${config.reactiveThreshold}`
      );
      lastShouldActivateLogTime = now;
    }
    return true;
  },

  createState: async (bot: Bot) => {
    if (isInCooldown()) {
      return null;
    }

    const sendChat: ((msg: string) => void) | null =
      typeof (bot as any)?.safeChat === 'function' ? (bot as any).safeChat.bind(bot) : null;

    const freeSlots = getEmptySlotCount(bot as any);
    const targetFree = config.reactiveThreshold + FREE_SLOT_BUFFER;
    const candidates = calculateItemsToDrop(bot, targetFree);

    if (candidates.length === 0) {
      logger.info(`InventoryManagement: no safe items to drop (${freeSlots} free slots)`);
      lastManagementTime = Date.now();
      return null;
    }

    logger.info(
      `InventoryManagement: starting - ${freeSlots} free slots, ${candidates.length} item(s) to drop`
    );
    if (sendChat) {
      sendChat(`inventory nearly full (${freeSlots} free slots), dropping ${candidates.length} item(s)`);
    }

    const enter = new BehaviorIdle();
    const exit = new BehaviorIdle();
    const toss = new BehaviorTossItems(bot, candidates, sendChat);

    const enterToToss = new StateTransition({
      parent: enter,
      child: toss,
      name: 'inventory-mgmt: enter -> toss',
      shouldTransition: () => true
    });

    const tossToExit = new StateTransition({
      parent: toss,
      child: exit,
      name: 'inventory-mgmt: toss -> exit',
      shouldTransition: () => toss.isFinished()
    });

    const stateMachine = new NestedStateMachine([enterToToss, tossToExit], enter, exit);

    return {
      stateMachine,
      isFinished: () =>
        typeof stateMachine.isFinished === 'function' ? stateMachine.isFinished() : false,
      wasSuccessful: () => toss.wasSuccessful(),
      onStop: (reason: ReactiveBehaviorStopReason) => {
        if (reason === 'completed') {
          lastManagementTime = Date.now();
          logger.debug(
            `InventoryManagement: completed, starting ${config.cooldownMs / 1000}s cooldown`
          );
        } else {
          logger.debug(`InventoryManagement: stopped (${reason})`);
        }
      }
    };
  }
};
