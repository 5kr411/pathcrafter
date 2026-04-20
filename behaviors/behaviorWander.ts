import logger from '../utils/logger';
import { forceStopAllMovement } from '../utils/movement';
import {
  randomAngle,
  offsetFromAngle
} from '../utils/blockProbe';

const { goals } = require('mineflayer-pathfinder');

const DEFAULT_DISTANCE = 128;
const TIMEOUT_SECONDS_PER_BLOCK = 1.5;
const GOAL_REACH_RANGE = 16;
// When pathfinder goes idle without reaching the goal, the current target is
// very likely unreachable from here. Re-issuing the *same* setGoal every 2 s
// (old behavior) just spams resetPath + packets; re-issuing the same goal
// never succeeds anyway. Instead, pick a fresh random target and retry, with
// a long enough cooldown that we don't flood the server's socket buffers.
const IDLE_REPICK_COOLDOWN_MS = 8000;

interface BotLike {
  entity?: { position: { x: number; y: number; z: number } };
  pathfinder?: any;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
  [key: string]: any;
}

export interface WanderAngleConstraint {
  /** Angle to avoid, in radians (e.g., direction toward a threat) */
  avoidAngle: number;
  /** Half-width of the excluded arc in radians. Default π/2 (90° excluded = ±45° around avoidAngle) */
  avoidArcHalf?: number;
}

export class BehaviorWander {
  bot: BotLike;
  distance: number;
  stateName: string = 'wander';
  active: boolean = false;
  isFinished: boolean = false;

  private goalReachedHandler: (() => void) | null = null;
  private safetyTimeout: ReturnType<typeof setTimeout> | null = null;
  private targetX: number = 0;
  private targetZ: number = 0;
  private lastGoalSetTime: number = 0;
  private angleConstraint: WanderAngleConstraint | null = null;
  private targets: { wanderYaw?: number; [key: string]: any } | null = null;

  constructor(
    bot: BotLike,
    distance: number = DEFAULT_DISTANCE,
    angleConstraint?: WanderAngleConstraint,
    targets?: { wanderYaw?: number; [key: string]: any }
  ) {
    this.bot = bot;
    this.distance = distance;
    this.angleConstraint = angleConstraint ?? null;
    this.targets = targets ?? null;
  }

  setAngleConstraint(constraint: WanderAngleConstraint | null): void {
    this.angleConstraint = constraint;
  }

  onStateEntered(): void {
    this.isFinished = false;
    this.active = true;

    const pathfinder = this.bot?.pathfinder;
    if (!pathfinder || typeof pathfinder.setGoal !== 'function') {
      logger.warn('BehaviorWander: no pathfinder available, finishing immediately');
      this.isFinished = true;
      return;
    }

    const pos = this.bot.entity?.position;
    if (!pos) {
      logger.warn('BehaviorWander: no bot position available, finishing immediately');
      this.isFinished = true;
      return;
    }

    this.pickTarget(pos);

    logger.info(
      `BehaviorWander: wandering ${this.distance} blocks to (${this.targetX.toFixed(1)}, ${this.targetZ.toFixed(1)})`
    );

    this.goalReachedHandler = () => {
      logger.info('BehaviorWander: goal reached');
      this.finish();
    };
    this.bot.on!('goal_reached', this.goalReachedHandler);

    const timeoutMs = this.distance * TIMEOUT_SECONDS_PER_BLOCK * 1000;
    this.safetyTimeout = setTimeout(() => {
      logger.info('BehaviorWander: safety timeout reached, finishing');
      this.finish();
    }, timeoutMs);

    this.setGoal();
  }

  update(): void {
    if (this.isFinished) return;
    const pathfinder = this.bot?.pathfinder;
    if (!pathfinder || typeof pathfinder.isMoving !== 'function') return;
    if (pathfinder.isMoving()) return;

    // Pathfinder is idle. Previous behavior re-set the *same* goal every 2 s,
    // which never changed the outcome (astar already decided it couldn't
    // reach it) but did generate a packet flurry per retry — multiplied by
    // 50 bots that was enough to push sockets into EPIPE. Instead, pick a
    // fresh random target on a long cooldown and let pathfinder try that.
    const pos = this.bot.entity?.position;
    if (!pos) return;
    if (Date.now() - this.lastGoalSetTime < IDLE_REPICK_COOLDOWN_MS) return;

    this.pickTarget(pos);
    logger.info(
      `BehaviorWander: pathfinder idle — picked new target (${this.targetX.toFixed(1)}, ${this.targetZ.toFixed(1)})`
    );
    this.setGoal();
  }

  onStateExited(): void {
    this.active = false;
    this.cleanup();
    forceStopAllMovement(this.bot, 'wander exit');
  }

  private pickTarget(pos: { x: number; y: number; z: number }): void {
    const angle = this.pickAngle();
    if (this.targets) {
      this.targets.wanderYaw = angle;
    }
    const target = offsetFromAngle(pos.x, pos.z, angle, this.distance);
    this.targetX = target.x;
    this.targetZ = target.z;
  }

  private pickAngle(): number {
    if (!this.angleConstraint) {
      return randomAngle();
    }

    const { avoidAngle, avoidArcHalf = Math.PI / 2 } = this.angleConstraint;
    // Pick a random angle in the allowed range (full circle minus the excluded arc)
    const allowedRange = 2 * Math.PI - 2 * avoidArcHalf;
    if (allowedRange <= 0) {
      // Arc excludes everything — just go opposite
      return avoidAngle + Math.PI;
    }
    const offset = avoidArcHalf + Math.random() * allowedRange;
    return avoidAngle + offset;
  }

  private setGoal(): void {
    try {
      const y = this.bot.entity?.position?.y ?? 64;
      const range = Math.min(GOAL_REACH_RANGE, Math.max(2, this.distance * 0.5));
      const goal = new goals.GoalNear(this.targetX, y, this.targetZ, range);
      this.bot.pathfinder.setGoal(goal);
      this.lastGoalSetTime = Date.now();
    } catch (err: any) {
      logger.warn(`BehaviorWander: failed to set goal - ${err?.message || err}`);
      this.finish();
    }
  }

  private finish(): void {
    if (this.isFinished) return;
    this.isFinished = true;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.goalReachedHandler && this.bot.removeListener) {
      this.bot.removeListener('goal_reached', this.goalReachedHandler);
      this.goalReachedHandler = null;
    }
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }
  }
}

export default BehaviorWander;
