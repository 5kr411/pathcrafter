import logger from '../utils/logger';
import { forceStopAllMovement } from '../utils/movement';

const { goals } = require('mineflayer-pathfinder');

const DEFAULT_DISTANCE = 128;
const TIMEOUT_SECONDS_PER_BLOCK = 1.5;
const GOAL_RESET_COOLDOWN_MS = 2000;

interface BotLike {
  entity?: { position: { x: number; y: number; z: number } };
  pathfinder?: any;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
  [key: string]: any;
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

  constructor(bot: BotLike, distance: number = DEFAULT_DISTANCE) {
    this.bot = bot;
    this.distance = distance;
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

    const angle = Math.random() * 2 * Math.PI;
    this.targetX = pos.x + this.distance * Math.cos(angle);
    this.targetZ = pos.z + this.distance * Math.sin(angle);

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

    if (!pathfinder.isMoving() && Date.now() - this.lastGoalSetTime > GOAL_RESET_COOLDOWN_MS) {
      logger.info('BehaviorWander: pathfinder idle, re-setting goal');
      this.setGoal();
    }
  }

  onStateExited(): void {
    this.active = false;
    this.cleanup();
    forceStopAllMovement(this.bot, 'wander exit');
  }

  private setGoal(): void {
    try {
      const goal = new goals.GoalXZ(this.targetX, this.targetZ);
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
