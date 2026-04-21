import { Vec3 } from 'vec3';
import { StateBehavior } from 'mineflayer-statemachine';
import { Bot } from './types';
import { findClosestCreeper, findShieldItem, isShieldUsable } from './shield_defense_behavior';
import { findClosestHostileMob, isRangedHostile } from './hostile_mob_behavior';
import logger from '../../../utils/logger';

const { goals } = require('mineflayer-pathfinder');

export const HOSTILE_FLEE_PRIORITY = 110;
export const TRIGGER_RADIUS = 16;
export const FLEE_RADIUS = 32;
export const GOAL_CHANGE_THRESHOLD = 2;
export const GOAL_REFRESH_MS = 750;
export const FLEE_MEMORY_MS = 5000;
export const LOW_ARMOR_THRESHOLD = 10;
export const LOW_HEALTH_RATIO = 0.6;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  distanceTo?: (other: any) => number;
}

export function hasUsableShield(bot: Bot): boolean {
  const shield = findShieldItem(bot);
  if (!shield) return false;
  return isShieldUsable(shield);
}

export function getArmorValue(bot: Bot): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const attr = (bot as any)?.entity?.attributes?.['generic.armor'];
  if (attr && typeof attr.value === 'number') return attr.value;
  return 0;
}

export function isLowArmor(bot: Bot): boolean {
  return getArmorValue(bot) < LOW_ARMOR_THRESHOLD;
}

export function isLowHealth(bot: Bot): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const current = (bot as any).health ?? 20;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const max = (bot as any).maxHealth ?? 20;
  return current > 0 && current < max * LOW_HEALTH_RATIO;
}

export function getDistance(a: Vec3Like, b: Vec3Like): number {
  if (typeof a.distanceTo === 'function') {
    return a.distanceTo(b);
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function computeFleeTarget(botPos: Vec3Like, threatPos: Vec3Like, distance: number): Vec3 {
  let dx = botPos.x - threatPos.x;
  let dz = botPos.z - threatPos.z;
  let len = Math.sqrt(dx * dx + dz * dz);

  if (!Number.isFinite(len) || len < 0.001) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dz = Math.sin(angle);
    len = 1;
  }

  const scale = Math.max(1, distance) / len;
  return new Vec3(botPos.x + dx * scale, botPos.y, botPos.z + dz * scale);
}

/**
 * Top-level "is there a threat worth fleeing from" check. Radius is
 * parameterized so `shouldActivate` uses TRIGGER_RADIUS (16) while the
 * fleeing states use FLEE_RADIUS (32) for continued observation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
export function getThreat(bot: Bot, radius: number): any | null {
  const creeper = findClosestCreeper(bot, radius);
  if (creeper) return creeper;
  const ranged = findClosestHostileMob(bot, radius, true, isRangedHostile);
  if (ranged && (isLowArmor(bot) || isLowHealth(bot))) return ranged;
  if (!isLowHealth(bot)) return null;
  return findClosestHostileMob(bot, radius, true);
}

/**
 * Shared mutable state handed to the three flee sub-states. Replaces
 * the closure that the previous single-state implementation captured.
 * Owned by the factory in `hostile_flee_behavior.createState` and
 * passed by reference into each `StateBehavior`.
 */
export interface FleeContext {
  threatLabel: string;
  lastKnownThreatPos: Vec3Like | null;
  lastThreatSeenTime: number;
  safeChat: ((msg: string) => void) | null;
  startAnnounced: boolean;
}

/**
 * Entry sub-state: observes the current threat, populates `ctx` with
 * its label and position, fires the one-shot "fleeing <label>" chat,
 * and immediately reports `isFinished() === true`. The outer NSM
 * reads `foundThreat()` to pick between the `FleeVisible` and `Exit`
 * transitions.
 */
export class BehaviorCaptureThreat implements StateBehavior {
  public stateName = 'CaptureThreat';
  public active = false;
  private finished = false;
  private threatFound = false;

  constructor(private readonly bot: Bot, private readonly ctx: FleeContext) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    this.threatFound = false;

    const threat = getThreat(this.bot, FLEE_RADIUS);
    if (!threat) {
      this.finished = true;
      return;
    }
    this.threatFound = true;
    this.ctx.threatLabel = String(threat.displayName || threat.name || 'hostile mob');
    this.ctx.lastKnownThreatPos = {
      x: threat.position.x,
      y: threat.position.y,
      z: threat.position.z
    };
    this.ctx.lastThreatSeenTime = Date.now();

    if (!this.ctx.startAnnounced && this.ctx.safeChat) {
      try {
        this.ctx.safeChat(`fleeing ${this.ctx.threatLabel}`);
      } catch (_) {
        // swallow chat errors; they must never destabilize the SM
      }
      this.ctx.startAnnounced = true;
    }

    this.finished = true;
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean {
    return this.finished;
  }

  foundThreat(): boolean {
    return this.threatFound;
  }
}

type VisibleExitReason = 'safe' | 'shield' | null;

/**
 * Active fleeing while the threat is still in line-of-sight. Refreshes
 * the pathfinder goal every `GOAL_REFRESH_MS` (or on a significant
 * direction change), records each observation onto `ctx.lastKnownThreatPos`
 * so `BehaviorFleeFromMemory` has somewhere to start if the threat is
 * lost. Terminates into the outer NSM's Exit state via one of:
 *  - shield acquired (`exitReason() === 'shield'`)
 *  - safe distance reached (`exitReason() === 'safe'`)
 * or yields to `BehaviorFleeFromMemory` via `lostThreat()`.
 */
export class BehaviorFleeVisible implements StateBehavior {
  public stateName = 'FleeVisible';
  public active = false;
  private finished = false;
  private _lostThreat = false;
  private _exitReason: VisibleExitReason = null;
  private lastGoal: Vec3 | null = null;
  private lastGoalTime = 0;

  constructor(private readonly bot: Bot, private readonly ctx: FleeContext) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    this._lostThreat = false;
    this._exitReason = null;
    this.lastGoal = null;
    this.lastGoalTime = 0;

    // On first entry the context was just populated by CaptureThreat.
    // On re-entry (from FleeFromMemory) ctx.lastKnownThreatPos still
    // points at the last sighting; either way it's the right seed for
    // the initial goal.
    if (this.ctx.lastKnownThreatPos) {
      this.setGoalAwayFrom(this.ctx.lastKnownThreatPos, true);
    }
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean {
    return this.finished;
  }

  lostThreat(): boolean {
    return this._lostThreat;
  }

  exitReason(): VisibleExitReason {
    return this._exitReason;
  }

  update(): void {
    if (this.finished || !this.active) return;

    if (hasUsableShield(this.bot)) {
      this.finished = true;
      this._exitReason = 'shield';
      return;
    }

    const botPos = this.bot?.entity?.position as Vec3Like | undefined;
    if (!botPos) return;

    const threat = getThreat(this.bot, FLEE_RADIUS);
    if (!threat) {
      this._lostThreat = true;
      return;
    }

    this.ctx.lastKnownThreatPos = {
      x: threat.position.x,
      y: threat.position.y,
      z: threat.position.z
    };
    this.ctx.lastThreatSeenTime = Date.now();

    if (getDistance(botPos, threat.position) >= FLEE_RADIUS) {
      this.finished = true;
      this._exitReason = 'safe';
      return;
    }

    const now = Date.now();
    if (!this.lastGoal || now - this.lastGoalTime >= GOAL_REFRESH_MS) {
      this.setGoalAwayFrom(threat.position, false);
    }
  }

  private setGoalAwayFrom(threatPos: Vec3Like, force: boolean): void {
    const botPos = this.bot?.entity?.position as Vec3Like | undefined;
    if (!botPos) return;
    const target = computeFleeTarget(botPos, threatPos, FLEE_RADIUS);
    if (!force && this.lastGoal && getDistance(this.lastGoal, target) < GOAL_CHANGE_THRESHOLD) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const pathfinder = (this.bot as any)?.pathfinder;
    if (!pathfinder || typeof pathfinder.setGoal !== 'function') return;
    try {
      pathfinder.setGoal(new goals.GoalXZ(target.x, target.z));
      this.lastGoal = target;
      this.lastGoalTime = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`FleeVisible: failed to set goal - ${err?.message || err}`);
    }
  }
}

type MemoryExitReason = 'safe' | 'shield' | 'memory' | null;

/**
 * Fleeing based on `ctx.lastKnownThreatPos` while the threat is out of
 * line-of-sight. Continues until one of:
 *  - threat reappears -> outer NSM transitions back to `BehaviorFleeVisible`
 *    via `threatReappeared()`
 *  - `FLEE_MEMORY_MS` elapses since `ctx.lastThreatSeenTime`
 *    (`exitReason() === 'memory'`)
 *  - bot reaches safe distance from last-known position
 *    (`exitReason() === 'safe'`)
 *  - a usable shield is acquired (`exitReason() === 'shield'`)
 *
 * Note: this state does NOT mutate `ctx.lastThreatSeenTime` — the
 * memory timer resets only when `BehaviorFleeVisible` re-observes the
 * threat, which naturally refreshes the timestamp.
 */
export class BehaviorFleeFromMemory implements StateBehavior {
  public stateName = 'FleeFromMemory';
  public active = false;
  private finished = false;
  private _threatReappeared = false;
  private _exitReason: MemoryExitReason = null;
  private lastGoal: Vec3 | null = null;
  private lastGoalTime = 0;

  constructor(private readonly bot: Bot, private readonly ctx: FleeContext) {}

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    this._threatReappeared = false;
    this._exitReason = null;
    this.lastGoal = null;
    this.lastGoalTime = 0;
    this.refreshGoal(true);
  }

  onStateExited(): void {
    this.active = false;
  }

  isFinished(): boolean {
    return this.finished;
  }

  threatReappeared(): boolean {
    return this._threatReappeared;
  }

  exitReason(): MemoryExitReason {
    return this._exitReason;
  }

  update(): void {
    if (this.finished || !this.active) return;

    if (hasUsableShield(this.bot)) {
      this.finished = true;
      this._exitReason = 'shield';
      return;
    }

    const threat = getThreat(this.bot, FLEE_RADIUS);
    if (threat) {
      this._threatReappeared = true;
      return;
    }

    const now = Date.now();
    if (now - this.ctx.lastThreatSeenTime >= FLEE_MEMORY_MS) {
      this.finished = true;
      this._exitReason = 'memory';
      return;
    }

    const botPos = this.bot?.entity?.position as Vec3Like | undefined;
    if (!botPos || !this.ctx.lastKnownThreatPos) return;
    if (getDistance(botPos, this.ctx.lastKnownThreatPos) >= FLEE_RADIUS) {
      this.finished = true;
      this._exitReason = 'safe';
      return;
    }

    if (!this.lastGoal || now - this.lastGoalTime >= GOAL_REFRESH_MS) {
      this.refreshGoal(false);
    }
  }

  private refreshGoal(force: boolean): void {
    if (!this.ctx.lastKnownThreatPos) return;
    const botPos = this.bot?.entity?.position as Vec3Like | undefined;
    if (!botPos) return;
    const target = computeFleeTarget(botPos, this.ctx.lastKnownThreatPos, FLEE_RADIUS);
    if (!force && this.lastGoal && getDistance(this.lastGoal, target) < GOAL_CHANGE_THRESHOLD) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const pathfinder = (this.bot as any)?.pathfinder;
    if (!pathfinder || typeof pathfinder.setGoal !== 'function') return;
    try {
      pathfinder.setGoal(new goals.GoalXZ(target.x, target.z));
      this.lastGoal = target;
      this.lastGoalTime = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`FleeFromMemory: failed to set goal - ${err?.message || err}`);
    }
  }
}
