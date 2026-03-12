const { BehaviorMoveTo } = require('mineflayer-statemachine');
import logger from '../utils/logger';
import { getStuckDetectionWindowMs } from '../utils/movementConfig';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
  clone?: () => Vec3Like;
  offset?: (x: number, y: number, z: number) => Vec3Like;
  floored?: () => Vec3Like;
  [key: string]: any;
}

interface Bot {
  entity?: {
    position: Vec3Like;
  };
  [key: string]: any;
}

interface PositionRecord {
  position: Vec3Like;
  timestamp: number;
}

export class BehaviorSmartMoveTo {
  bot: Bot;
  targets: any;
  private moveTo: any;
  private originalTarget: Vec3Like | null = null;
  private positionHistory: PositionRecord[] = [];
  private isStuck: boolean = false;
  private isUnsticking: boolean = false;
  private unstickTarget: Vec3Like | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private allowUnstick: boolean = true;
  private unstickAttempts: number = 0;
  private readonly MAX_UNSTICK_ATTEMPTS = 5;
  private _gaveUp: boolean = false;
  private _pathfindingSettled: boolean = false;
  private _enteredAt: number = 0;
  private _pathUpdateHandler: ((r: any) => void) | null = null;
  private _goalReachedHandler: (() => void) | null = null;
  private readonly MIN_SETTLE_MS = 600;

  constructor(bot: Bot, targets: any) {
    this.bot = bot;
    this.targets = targets;
    this.moveTo = new BehaviorMoveTo(bot, targets);
    
    this.onStateEntered = this.onStateEntered.bind(this);
    this.onStateExited = this.onStateExited.bind(this);
  }

  get distance(): number {
    return this.moveTo.distance;
  }

  set distance(value: number) {
    this.moveTo.distance = value;
  }

  isFinished(): boolean {
    if (this._gaveUp) return true;

    if (!this._pathfindingSettled) {
      if (Date.now() - this._enteredAt >= this.MIN_SETTLE_MS) {
        this._pathfindingSettled = true;
      } else {
        return false;
      }
    }

    return this.moveTo.isFinished();
  }

  distanceToTarget(): number {
    return this.moveTo.distanceToTarget();
  }

  onStateEntered(): void {
    logger.debug('BehaviorSmartMoveTo: onStateEntered called');
    this.originalTarget = this.targets.position ? this.clonePosition(this.targets.position) : null;
    this.positionHistory = [];
    this.isStuck = false;
    this.isUnsticking = false;
    this.unstickTarget = null;
    this.unstickAttempts = 0;
    this._gaveUp = false;
    this._pathfindingSettled = false;
    this._enteredAt = Date.now();
    this.allowUnstick = this.targets?.disableSmartMoveUnstick !== true;

    if (this.targets) {
      if (typeof this.targets.smartMoveStuckCount === 'number') {
        this.targets.smartMoveStuckCount = 0;
      } else if ('smartMoveStuckCount' in this.targets) {
        delete this.targets.smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in this.targets) {
        delete this.targets.lastSmartMoveStuck;
      }
    }

    // Register pathfinder event listeners BEFORE starting movement
    // so we capture events from the very first tick
    if (typeof this.bot.on === 'function') {
      this._pathUpdateHandler = () => {
        this._pathfindingSettled = true;
      };
      this._goalReachedHandler = () => {
        this._pathfindingSettled = true;
      };
      this.bot.on('path_update', this._pathUpdateHandler);
      this.bot.on('goal_reached', this._goalReachedHandler);
    }

    this.recordCurrentPosition();

    this.checkInterval = setInterval(() => {
      this.checkIfStuck();
    }, 1000);

    logger.debug(`BehaviorSmartMoveTo: Started stuck detection interval for target at (${this.originalTarget?.x}, ${this.originalTarget?.y}, ${this.originalTarget?.z})`);

    if (this.moveTo.onStateEntered) {
      this.moveTo.onStateEntered();
    }
  }

  onStateExited(): void {
    logger.debug('BehaviorSmartMoveTo: onStateExited called');
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.debug('BehaviorSmartMoveTo: Cleared stuck detection interval');
    }

    // Remove pathfinder event listeners
    if (this._pathUpdateHandler && typeof this.bot.removeListener === 'function') {
      this.bot.removeListener('path_update', this._pathUpdateHandler);
      this._pathUpdateHandler = null;
    }
    if (this._goalReachedHandler && typeof this.bot.removeListener === 'function') {
      this.bot.removeListener('goal_reached', this._goalReachedHandler);
      this._goalReachedHandler = null;
    }
    this._pathfindingSettled = false;

    this.positionHistory = [];
    this.isStuck = false;
    this.isUnsticking = false;
    this.unstickAttempts = 0;
    this._gaveUp = false;
    this.allowUnstick = true;

    if (this.targets) {
      if ('smartMoveStuckCount' in this.targets) {
        delete this.targets.smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in this.targets) {
        delete this.targets.lastSmartMoveStuck;
      }
    }

    if (this.moveTo.onStateExited) {
      this.moveTo.onStateExited();
    }
  }

  private clonePosition(pos: Vec3Like): Vec3Like {
    if (pos.clone) {
      return pos.clone();
    }
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  private recordCurrentPosition(): void {
    if (!this.bot.entity?.position) return;

    const now = Date.now();
    const currentPos = this.clonePosition(this.bot.entity.position);

    this.positionHistory.push({
      position: currentPos,
      timestamp: now
    });

    const windowMs = getStuckDetectionWindowMs();
    const historyWindowMs = windowMs + 2000;
    const cutoff = now - historyWindowMs;
    this.positionHistory = this.positionHistory.filter(record => record.timestamp >= cutoff);
  }

  private getDistanceBetween(pos1: Vec3Like, pos2: Vec3Like): number {
    if (pos1.distanceTo) {
      return pos1.distanceTo(pos2);
    }
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private checkIfStuck(): void {
    this.recordCurrentPosition();
    
    const currentPos = this.bot.entity?.position;
    if (!currentPos) return;
    
    if (this.positionHistory.length > 0) {
      const oldestInHistory = this.positionHistory[0];
      const timespan = Date.now() - oldestInHistory.timestamp;
      const distance = this.getDistanceBetween(oldestInHistory.position, currentPos);
      logger.debug(`BehaviorSmartMoveTo: Check - ${this.positionHistory.length} records, ${(timespan/1000).toFixed(1)}s span, ${distance.toFixed(2)} blocks moved`);
    }

    if (this.isUnsticking) {
      if (this.moveTo.isFinished()) {
        logger.info('BehaviorSmartMoveTo: Unstick complete, retrying original target');
        this.isUnsticking = false;
        this.isStuck = false;
        this.positionHistory = [];
        
        if (this.originalTarget) {
          this.targets.position = this.originalTarget;
          this.moveTo = new BehaviorMoveTo(this.bot, this.targets);
          this.moveTo.distance = this.distance;
          if (this.moveTo.onStateEntered) {
            this.moveTo.onStateEntered();
          }
        }
        return;
      }
      
      const oldestRecord = this.positionHistory[0];
      const now = Date.now();
      const timespan = now - oldestRecord.timestamp;

      const windowMs = getStuckDetectionWindowMs();
      if (timespan >= windowMs) {
        const distanceMoved = this.getDistanceBetween(oldestRecord.position, currentPos);
        
        if (distanceMoved < 2) {
          if (this.unstickAttempts >= this.MAX_UNSTICK_ATTEMPTS) {
            logger.warn(`BehaviorSmartMoveTo: Gave up after ${this.unstickAttempts} unstick attempts (moved ${distanceMoved.toFixed(2)} blocks)`);
            this._gaveUp = true;
            this.isUnsticking = false;
            return;
          }
          logger.warn(`BehaviorSmartMoveTo: Still stuck while unsticking! Moved only ${distanceMoved.toFixed(2)} blocks. (attempt ${this.unstickAttempts}/${this.MAX_UNSTICK_ATTEMPTS})`);

          this.positionHistory = [];
          this.initiateUnstick();
        }
      }
      return;
    }

    if (this.moveTo.isFinished()) {
      return;
    }

    if (this.positionHistory.length < 2) {
      return;
    }

    const oldestRecord = this.positionHistory[0];
    const now = Date.now();
    const timespan = now - oldestRecord.timestamp;

    const windowMs = getStuckDetectionWindowMs();
    if (timespan < windowMs) {
      return;
    }

    const distanceMoved = this.getDistanceBetween(oldestRecord.position, currentPos);

    if (distanceMoved < 2 && !this.isStuck) {
      this.isStuck = true;
      logger.warn(`BehaviorSmartMoveTo: Bot is stuck! Moved only ${distanceMoved.toFixed(2)} blocks in ${(timespan/1000).toFixed(1)} seconds`);

      if (this.targets) {
        const now = Date.now();
        this.targets.lastSmartMoveStuck = now;
        const prevCount = Number(this.targets.smartMoveStuckCount) || 0;
        this.targets.smartMoveStuckCount = prevCount + 1;
      }

      if (this.allowUnstick) {
        this.initiateUnstick();
      } else {
        logger.debug('BehaviorSmartMoveTo: Unstick suppressed for current targets');
      }
    }
  }

  private initiateUnstick(): void {
    if (!this.allowUnstick) {
      logger.debug('BehaviorSmartMoveTo: initiateUnstick called but unstick disabled');
      return;
    }
    if (!this.bot.entity?.position) return;

    this.unstickAttempts++;
    const currentPos = this.bot.entity.position;
    const randomAngle = Math.random() * 2 * Math.PI;
    const unstickDistance = 2 * this.unstickAttempts;

    const offsetX = unstickDistance * Math.cos(randomAngle);
    const offsetZ = unstickDistance * Math.sin(randomAngle);

    const offsetY = this.unstickAttempts >= 3 ? 4 : 0;

    this.unstickTarget = {
      x: currentPos.x + offsetX,
      y: currentPos.y + offsetY,
      z: currentPos.z + offsetZ
    };

    logger.info(`BehaviorSmartMoveTo: Moving to unstick position at (${this.unstickTarget.x.toFixed(1)}, ${this.unstickTarget.y.toFixed(1)}, ${this.unstickTarget.z.toFixed(1)})`);

    if (this.moveTo.onStateExited) {
      this.moveTo.onStateExited();
    }

    this.targets.position = this.unstickTarget;
    this.moveTo = new BehaviorMoveTo(this.bot, this.targets);
    this.moveTo.distance = this.distance;
    
    if (this.moveTo.onStateEntered) {
      this.moveTo.onStateEntered();
    }

    this.isUnsticking = true;
    this.isStuck = false;
    this.positionHistory = [];
  }

}

export default BehaviorSmartMoveTo;
