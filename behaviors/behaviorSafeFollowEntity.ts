const { BehaviorFollowEntity, BehaviorMoveTo } = require('mineflayer-statemachine');
import logger from '../utils/logger';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
  clone?: () => Vec3Like;
  [key: string]: any;
}

interface Entity {
  position?: Vec3Like;
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

export class BehaviorSafeFollowEntity {
  bot: Bot;
  targets: any;
  private followEntity: any;
  private moveTo: any = null;
  private positionHistory: PositionRecord[] = [];
  private isStuck: boolean = false;
  private isUnsticking: boolean = false;
  private unstickTarget: Vec3Like | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private allowUnstick: boolean = true;
  private savedEntity: Entity | null = null;

  constructor(bot: Bot, targets: any) {
    this.bot = bot;
    this.targets = targets;
    this.followEntity = new BehaviorFollowEntity(bot, targets);
    
    this.onStateEntered = this.onStateEntered.bind(this);
    this.onStateExited = this.onStateExited.bind(this);
  }

  get followDistance(): number {
    return this.followEntity.followDistance;
  }

  set followDistance(value: number) {
    this.followEntity.followDistance = value;
  }

  get movements(): any {
    return this.followEntity.movements;
  }

  set movements(value: any) {
    this.followEntity.movements = value;
  }

  isFinished(): boolean {
    if (this.isUnsticking) {
      return false;
    }
    return this.followEntity.isFinished();
  }

  distanceToTarget(): number {
    if (this.isUnsticking && this.moveTo) {
      return this.moveTo.distanceToTarget();
    }
    return this.followEntity.distanceToTarget();
  }

  onStateEntered(): void {
    logger.debug('BehaviorSafeFollowEntity: onStateEntered called');
    this.positionHistory = [];
    this.isStuck = false;
    this.isUnsticking = false;
    this.unstickTarget = null;
    this.moveTo = null;
    this.savedEntity = null;
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

    this.recordCurrentPosition();
    
    this.checkInterval = setInterval(() => {
      this.checkIfStuck();
    }, 1000);
    
    const entityName = this.targets.entity?.name || this.targets.entity?.displayName || 'unknown';
    logger.debug(`BehaviorSafeFollowEntity: Started stuck detection interval for entity ${entityName}`);

    if (this.followEntity.onStateEntered) {
      this.followEntity.onStateEntered();
    }
  }

  onStateExited(): void {
    logger.debug('BehaviorSafeFollowEntity: onStateExited called');
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.debug('BehaviorSafeFollowEntity: Cleared stuck detection interval');
    }

    this.positionHistory = [];
    this.isStuck = false;
    this.isUnsticking = false;
    this.allowUnstick = true;
    this.savedEntity = null;

    if (this.targets) {
      if ('smartMoveStuckCount' in this.targets) {
        delete this.targets.smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in this.targets) {
        delete this.targets.lastSmartMoveStuck;
      }
    }

    if (this.moveTo && this.moveTo.onStateExited) {
      this.moveTo.onStateExited();
      this.moveTo = null;
    }

    if (this.followEntity.onStateExited) {
      this.followEntity.onStateExited();
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

    const twentyOneSecondsAgo = now - 21000;
    this.positionHistory = this.positionHistory.filter(record => record.timestamp >= twentyOneSecondsAgo);
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
      logger.debug(`BehaviorSafeFollowEntity: Check - ${this.positionHistory.length} records, ${(timespan/1000).toFixed(1)}s span, ${distance.toFixed(2)} blocks moved`);
    }

    if (this.isUnsticking) {
      if (this.moveTo && this.moveTo.isFinished()) {
        logger.info('BehaviorSafeFollowEntity: Unstick complete, resuming entity follow');
        this.isUnsticking = false;
        this.isStuck = false;
        this.positionHistory = [];
        
        if (this.moveTo.onStateExited) {
          this.moveTo.onStateExited();
        }
        this.moveTo = null;
        
        if (this.savedEntity) {
          this.targets.entity = this.savedEntity;
          this.savedEntity = null;
        }
        
        this.followEntity = new BehaviorFollowEntity(this.bot, this.targets);
        this.followEntity.followDistance = this.followDistance;
        if (this.followEntity.onStateEntered) {
          this.followEntity.onStateEntered();
        }
        return;
      }
      
      if (this.positionHistory.length < 2) return;
      
      const oldestRecord = this.positionHistory[0];
      const now = Date.now();
      const timespan = now - oldestRecord.timestamp;

      if (timespan >= 20000) {
        const distanceMoved = this.getDistanceBetween(oldestRecord.position, currentPos);
        
        if (distanceMoved < 2) {
          logger.warn(`BehaviorSafeFollowEntity: Still stuck while unsticking! Moved only ${distanceMoved.toFixed(2)} blocks.`);
          this.positionHistory = [];
          this.initiateUnstick();
        }
      }
      return;
    }

    if (!this.targets.entity) {
      return;
    }

    if (this.followEntity.isFinished && this.followEntity.isFinished()) {
      return;
    }

    if (this.positionHistory.length < 2) {
      return;
    }

    const oldestRecord = this.positionHistory[0];
    const now = Date.now();
    const timespan = now - oldestRecord.timestamp;

    if (timespan < 20000) {
      return;
    }

    const distanceMoved = this.getDistanceBetween(oldestRecord.position, currentPos);

    if (distanceMoved < 2 && !this.isStuck) {
      this.isStuck = true;
      logger.warn(`BehaviorSafeFollowEntity: Bot is stuck! Moved only ${distanceMoved.toFixed(2)} blocks in ${(timespan/1000).toFixed(1)} seconds`);

      if (this.targets) {
        const now = Date.now();
        this.targets.lastSmartMoveStuck = now;
        const prevCount = Number(this.targets.smartMoveStuckCount) || 0;
        this.targets.smartMoveStuckCount = prevCount + 1;
      }

      if (this.allowUnstick) {
        this.initiateUnstick();
      } else {
        logger.debug('BehaviorSafeFollowEntity: Unstick suppressed for current targets');
      }
    }
  }

  private initiateUnstick(): void {
    if (!this.allowUnstick) {
      logger.debug('BehaviorSafeFollowEntity: initiateUnstick called but unstick disabled');
      return;
    }
    if (!this.bot.entity?.position) return;

    this.savedEntity = this.targets.entity;

    const currentPos = this.bot.entity.position;
    const randomAngle = Math.random() * 2 * Math.PI;
    const unstickDistance = 5;

    const offsetX = unstickDistance * Math.cos(randomAngle);
    const offsetZ = unstickDistance * Math.sin(randomAngle);

    this.unstickTarget = {
      x: currentPos.x + offsetX,
      y: currentPos.y,
      z: currentPos.z + offsetZ
    };

    logger.info(`BehaviorSafeFollowEntity: Moving to unstick position at (${this.unstickTarget.x.toFixed(1)}, ${this.unstickTarget.y.toFixed(1)}, ${this.unstickTarget.z.toFixed(1)})`);

    if (this.followEntity.onStateExited) {
      this.followEntity.onStateExited();
    }

    this.targets.position = this.unstickTarget;
    this.moveTo = new BehaviorMoveTo(this.bot, this.targets);
    this.moveTo.distance = 1;
    
    if (this.moveTo.onStateEntered) {
      this.moveTo.onStateEntered();
    }

    this.isUnsticking = true;
    this.isStuck = false;
    this.positionHistory = [];
  }
}

export default BehaviorSafeFollowEntity;
