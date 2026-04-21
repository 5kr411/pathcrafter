/**
 * Inventory management reactive behavior (factory form).
 *
 * Drops low-value / duplicate / excess items when the bot's free slot
 * count drops below a threshold. Runs a nested state machine that
 * wanders a few blocks, clears a box, tosses candidates, and moves back.
 *
 * All state (config, cooldowns, log-throttle timer) lives in the factory
 * closure — no module singletons. The factory handle is attached to the
 * bot at wiring time (`bot.__reactiveBehaviors.inventoryManagement`)
 * so `ensureInventoryRoom` in `utils/inventoryGate.ts` can reach it
 * without a new parameter on its call sites.
 */

import { BehaviorIdle, NestedStateMachine, StateTransition } from 'mineflayer-statemachine';
import { Vec3 } from 'vec3';
import { ReactiveBehavior, Bot, ReactiveBehaviorStopReason } from './types';
import { getEmptySlotCount } from '../../../utils/inventory';
import { isFood } from '../../../utils/foodConfig';
import { isWorkstation, isTool } from '../../../utils/persistentItemsConfig';
import { rank, getSuffixTokenFromName } from '../../../utils/items';
import logger from '../../../utils/logger';
import { BehaviorCaptureOrigin } from '../../../behaviors/behaviorCaptureOrigin';
import { BehaviorTossCandidates } from '../../../behaviors/behaviorTossCandidates';
import { BehaviorWander } from '../../../behaviors/behaviorWander';
import { BehaviorSmartMoveTo } from '../../../behaviors/behaviorSmartMoveTo';
import createClearAreaState from '../../../behaviors/behaviorClearArea';
import createLookAtState from '../../../behaviors/behaviorLookAt';

const INVENTORY_MANAGEMENT_PRIORITY = 30;
const SHOULD_ACTIVATE_LOG_INTERVAL_MS = 10_000;
const FREE_SLOT_BUFFER = 2;
const MACHINE_SAFETY_TIMEOUT_MS = 30_000;
const WANDER_DISTANCE = 5;
const CLEAR_AREA_AHEAD_BLOCKS = 2;
const CLEAR_RADIUS_HORIZONTAL = 0;
const CLEAR_RADIUS_VERTICAL = 2;
const EYE_HEIGHT_OFFSET = 1;
const LOOK_AT_DISTANCE = 5;

export interface InventoryManagementConfig {
  reactiveThreshold: number;
  preGateThreshold: number;
  cooldownMs: number;
  /** @deprecated alias for reactiveThreshold; accepted in setConfig only */
  triggerFreeSlots?: number;
  getTargets: () => Array<{ item: string; count: number }>;
}

const DEFAULT_CONFIG: InventoryManagementConfig = {
  reactiveThreshold: 3,
  preGateThreshold: 2,
  cooldownMs: 30_000,
  getTargets: () => []
};

export interface DropCandidate {
  item: any;
  reason: 'lower_tier_tool' | 'duplicate_stack' | 'excess_over_target';
}

export interface InventoryManagementMachine {
  stateMachine: any;
  droppedCount: () => number;
  run: () => Promise<void>;
}

export interface InventoryManagementOptions {
  config?: Partial<InventoryManagementConfig>;
}

export interface InventoryManagementHandle {
  behavior: ReactiveBehavior;
  setConfig(partial: Partial<InventoryManagementConfig>): void;
  getConfig(): InventoryManagementConfig;
  resetCooldown(): void;
  triggerCooldown(): void;
  /**
   * Build (but do not run) the inventory-management nested state machine.
   * Used by `ensureInventoryRoom` to bypass cooldown and force a drop pass.
   * Returns `null` when no safe items would be dropped.
   */
  buildMachine(bot: Bot): InventoryManagementMachine | null;
}

// --- Pure helpers (no state) ---

function isProtectedItem(_bot: Bot, itemName: string): boolean {
  if (isFood(itemName)) return true;
  if (isWorkstation(itemName)) return true;
  return false;
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

/**
 * Pure function: given a bot, a target free-slot count, and a
 * getTargets() accessor (for protected quantities), returns the list
 * of items to drop. Factored out of the factory so tests can call it
 * directly without instantiating the factory.
 */
export function calculateItemsToDrop(
  bot: Bot,
  targetFreeSlots: number,
  getTargets: () => Array<{ item: string; count: number }> = () => []
): DropCandidate[] {
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

  const getProtectedQuantity = (itemName: string): number => {
    if (isFood(itemName)) return Infinity;
    if (isWorkstation(itemName)) return Infinity;
    try {
      const targets = getTargets() ?? [];
      let total = 0;
      for (const t of targets) {
        if (t?.item === itemName) total += t.count || 0;
      }
      return total;
    } catch (_) {
      return 0;
    }
  };

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
      if ((stack.count || 0) > excess) continue; // whole-stack only; remainder falls through to Phase 2 if still needed
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
    if (protectedQty <= 0) return true; // no protection floor → phase 1/2 free to drop
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

// --- State machine helpers (no closure state) ---

/**
 * Synthesize a look-at point `LOOK_AT_DISTANCE` blocks ahead of the bot along
 * `yaw`, at eye height. LookAt reads targets.position, so we compute a Vec3
 * that represents the direction we want the bot to face.
 */
function computeLookAtPoint(bot: Bot, yaw: number): Vec3 | null {
  const pos = (bot as any)?.entity?.position;
  if (!pos) return null;
  const dx = -Math.sin(yaw) * LOOK_AT_DISTANCE;
  const dz = -Math.cos(yaw) * LOOK_AT_DISTANCE;
  return new Vec3(pos.x + dx, pos.y + EYE_HEIGHT_OFFSET, pos.z + dz);
}

/**
 * Place the clear-area center a couple of blocks in front of the bot along
 * `yaw`. ClearArea will dig a compact box (h=0,v=2 → 1×2×1) so tossed items
 * land in open space without over-digging.
 */
function computeClearBoxOrigin(bot: Bot, yaw: number): Vec3 | null {
  const pos = (bot as any)?.entity?.position;
  if (!pos) return null;
  const dx = -Math.sin(yaw) * CLEAR_AREA_AHEAD_BLOCKS;
  const dz = -Math.cos(yaw) * CLEAR_AREA_AHEAD_BLOCKS;
  return new Vec3(Math.floor(pos.x + dx), Math.floor(pos.y), Math.floor(pos.z + dz));
}

function subStateFinished(s: any): boolean {
  if (!s) return true;
  if (typeof s.isFinished === 'function') {
    try {
      return !!s.isFinished();
    } catch (_) {
      return false;
    }
  }
  return s.isFinished === true;
}

/**
 * Drive a NestedStateMachine to completion. Calls onStateEntered once, then
 * polls isFinished() every 50ms. Resolves when finished or after a 30s safety
 * timeout. Errors from poll/onStateEntered are logged and treated as "done".
 */
function runMachine(stateMachine: any): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let poll: NodeJS.Timeout | null = null;
    let safety: NodeJS.Timeout | null = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      if (safety) clearTimeout(safety);
      resolve();
    };
    try {
      if (typeof stateMachine?.onStateEntered === 'function') {
        stateMachine.onStateEntered();
      }
    } catch (err: any) {
      logger.warn(`inventoryManagementMachine: onStateEntered threw - ${err?.message || err}`);
      settle();
      return;
    }
    poll = setInterval(() => {
      try {
        if (typeof stateMachine?.isFinished === 'function' && stateMachine.isFinished()) {
          settle();
          return;
        }
        if (typeof stateMachine?.update === 'function') {
          stateMachine.update();
        }
      } catch (err: any) {
        logger.warn(`inventoryManagementMachine: poll threw - ${err?.message || err}`);
        settle();
      }
    }, 50);
    safety = setTimeout(() => {
      logger.warn('inventoryManagementMachine: 30s safety timeout - forcing resolve');
      settle();
    }, MACHINE_SAFETY_TIMEOUT_MS);
  });
}

// --- Factory ---

export function createInventoryManagementBehavior(
  opts: InventoryManagementOptions = {}
): InventoryManagementHandle {
  let config: InventoryManagementConfig = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
  let lastManagementTime = 0;
  let lastShouldActivateLogTime = 0;

  function setConfig(partial: Partial<InventoryManagementConfig>): void {
    const { triggerFreeSlots, ...rest } = partial;
    if (triggerFreeSlots !== undefined) {
      config = { ...config, reactiveThreshold: triggerFreeSlots, ...rest };
    } else {
      config = { ...config, ...rest };
    }
  }

  function getConfig(): InventoryManagementConfig {
    return { ...config };
  }

  function resetCooldown(): void {
    lastManagementTime = 0;
  }

  function triggerCooldown(): void {
    lastManagementTime = Date.now() || 1;
  }

  function isInCooldown(): boolean {
    if (lastManagementTime === 0) return false;
    return Date.now() - lastManagementTime < config.cooldownMs;
  }

  function buildMachine(bot: Bot): InventoryManagementMachine | null {
    const targetFree = config.reactiveThreshold + FREE_SLOT_BUFFER;
    const dropCandidates = calculateItemsToDrop(bot, targetFree, config.getTargets);
    if (dropCandidates.length === 0) return null;

    // Shared targets object drives every sub-state. CaptureOrigin writes
    // originPosition; Wander writes wanderYaw; we populate targets.position
    // (for LookAt and SmartMoveTo) and targets.placePosition (for ClearArea)
    // inside transition `onTransition` callbacks once the upstream state has
    // produced the data we need.
    const targets: any = { dropCandidates };

    const capture = new BehaviorCaptureOrigin(bot as any, targets);
    const wander = new BehaviorWander(bot as any, WANDER_DISTANCE, undefined, targets);
    const lookAt = createLookAtState(bot as any, targets);
    const clear = createClearAreaState(bot as any, targets);
    const toss = new BehaviorTossCandidates(bot as any, targets);
    const back = new BehaviorSmartMoveTo(bot as any, targets);
    const exit = new BehaviorIdle();

    const transitions = [
      new StateTransition({
        parent: capture,
        child: wander,
        name: 'inv-mgmt: capture -> wander',
        shouldTransition: () => capture.isFinished()
      }),
      new StateTransition({
        parent: wander,
        child: lookAt,
        name: 'inv-mgmt: wander -> lookAt',
        shouldTransition: () => subStateFinished(wander),
        onTransition: () => {
          const yaw = typeof targets.wanderYaw === 'number'
            ? targets.wanderYaw
            : ((bot as any)?.entity?.yaw ?? 0);
          const point = computeLookAtPoint(bot, yaw);
          if (point) targets.position = point;
        }
      }),
      new StateTransition({
        parent: lookAt,
        child: clear,
        name: 'inv-mgmt: lookAt -> clearArea',
        shouldTransition: () => subStateFinished(lookAt),
        onTransition: () => {
          const yaw = typeof targets.wanderYaw === 'number' ? targets.wanderYaw : 0;
          const boxOrigin = computeClearBoxOrigin(bot, yaw);
          if (boxOrigin) {
            targets.placePosition = boxOrigin;
            targets.clearRadiusHorizontal = CLEAR_RADIUS_HORIZONTAL;
            targets.clearRadiusVertical = CLEAR_RADIUS_VERTICAL;
          }
        }
      }),
      new StateTransition({
        parent: clear,
        child: toss,
        name: 'inv-mgmt: clearArea -> toss',
        shouldTransition: () => subStateFinished(clear)
      }),
      new StateTransition({
        parent: toss,
        child: back as any,
        name: 'inv-mgmt: toss -> moveBack',
        shouldTransition: () => toss.isFinished(),
        onTransition: () => {
          if (targets.originPosition) {
            const o = targets.originPosition;
            // SmartMoveTo snapshots targets.position in onStateEntered, so
            // overwriting here (after LookAt wrote a forward-looking point
            // into it) is safe.
            targets.position = new Vec3(o.x, o.y, o.z);
          }
        }
      }),
      new StateTransition({
        parent: back as any,
        child: exit,
        name: 'inv-mgmt: moveBack -> exit',
        shouldTransition: () => subStateFinished(back)
      })
    ];

    const stateMachine = new NestedStateMachine(transitions, capture, exit);

    return {
      stateMachine,
      droppedCount: () => toss.droppedCount(),
      run: () => runMachine(stateMachine)
    };
  }

  const behavior: ReactiveBehavior = {
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

      const freeSlots = getEmptySlotCount(bot as any);
      const built = buildMachine(bot);

      if (!built) {
        logger.info(`InventoryManagement: no safe items to drop (${freeSlots} free slots)`);
        lastManagementTime = Date.now();
        return null;
      }

      const sendChat: ((msg: string) => void) | null =
        typeof (bot as any)?.safeChat === 'function' ? (bot as any).safeChat.bind(bot) : null;

      logger.info(
        `InventoryManagement: starting - ${freeSlots} free slots`
      );
      if (sendChat) {
        sendChat(`inventory nearly full (${freeSlots} free slots), dropping items`);
      }

      return {
        stateMachine: built.stateMachine,
        isFinished: () =>
          typeof built.stateMachine.isFinished === 'function' ? built.stateMachine.isFinished() : false,
        wasSuccessful: () => built.droppedCount() > 0,
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

  return {
    behavior,
    setConfig,
    getConfig,
    resetCooldown,
    triggerCooldown,
    buildMachine
  };
}
