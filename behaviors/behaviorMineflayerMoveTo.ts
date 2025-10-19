const { BehaviorMoveTo } = require('mineflayer-statemachine');
import { MovementGoal, goalToMineflayerPosition } from './movementTypes';
import logger from '../utils/logger';

interface Bot {
  entity?: any;
  [key: string]: any;
}

interface Targets {
  position?: any;
  goal?: MovementGoal;
  [key: string]: any;
}

class BehaviorMineflayerMoveTo {
  private bot: Bot;
  private targets: Targets;
  private moveTo: any;
  private lastProgressCheckPosition: any;
  private lastProgressCheckTime: number;
  private stuckDetected: boolean;
  public stateName: string;
  public active: boolean;

  constructor(bot: Bot, targets: Targets) {
    this.bot = bot;
    this.targets = targets;
    this.stateName = 'BehaviorMineflayerMoveTo';
    this.active = false;
    this.lastProgressCheckPosition = null;
    this.lastProgressCheckTime = 0;
    this.stuckDetected = false;
    
    this.moveTo = null;
  }

  get distance(): number {
    return this.moveTo?.distance || 0;
  }

  set distance(value: number) {
    if (this.moveTo) {
      this.moveTo.distance = value;
    }
  }

  get movements(): any {
    return this.moveTo?.movements;
  }

  set movements(value: any) {
    if (this.moveTo) {
      this.moveTo.movements = value;
    }
  }

  onStateEntered(): void {
    if (this.targets.goal && !this.targets.position) {
      const position = goalToMineflayerPosition(this.targets.goal);
      if (position) {
        this.targets.position = position;
      }
    }
    
    // Recreate BehaviorMoveTo for each new attempt to ensure clean state
    this.moveTo = new BehaviorMoveTo(this.bot, this.targets);
    
    this.lastProgressCheckTime = Date.now();
    this.stuckDetected = false;
    
    if (this.bot.entity?.position) {
      this.lastProgressCheckPosition = this.bot.entity.position.clone();
    }
    
    if (this.moveTo.onStateEntered) {
      this.moveTo.onStateEntered();
    }
    this.active = true;
  }

  onStateExited(): void {
    if (this.moveTo?.onStateExited) {
      this.moveTo.onStateExited();
    }
    this.active = false;
  }

  isFinished(): boolean {
    // Check for stuck detection: has the bot made progress in the last 10 seconds?
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastProgressCheckTime;
    
    if (timeSinceLastCheck >= 10000 && this.bot.entity?.position && this.lastProgressCheckPosition) {
      const currentPos = this.bot.entity.position;
      const distanceMoved = Math.sqrt(
        Math.pow(currentPos.x - this.lastProgressCheckPosition.x, 2) +
        Math.pow(currentPos.y - this.lastProgressCheckPosition.y, 2) +
        Math.pow(currentPos.z - this.lastProgressCheckPosition.z, 2)
      );
      
      const targetDistance = this.distanceToTarget();
      
      // If we haven't moved more than 2 blocks in the last 10 seconds AND we're still far from target, we're stuck
      if (distanceMoved < 2 && targetDistance > 5) {
        logger.warn(`BehaviorMineflayerMoveTo: stuck detected (moved ${distanceMoved.toFixed(2)}m in last ${(timeSinceLastCheck/1000).toFixed(1)}s, ${targetDistance.toFixed(2)}m from target)`);
        this.stuckDetected = true;
        return true;
      }
      
      // Update last check position and time for next iteration
      this.lastProgressCheckPosition = currentPos.clone();
      this.lastProgressCheckTime = now;
    }
    
    if (this.moveTo?.isFinished) {
      return this.moveTo.isFinished();
    }
    return false;
  }
  
  didFail(): boolean {
    return this.stuckDetected;
  }

  distanceToTarget(): number {
    if (this.moveTo?.distanceToTarget) {
      return this.moveTo.distanceToTarget();
    }
    return Infinity;
  }
}

function createMineflayerMoveToState(bot: Bot, targets: Targets): BehaviorMineflayerMoveTo {
  return new BehaviorMineflayerMoveTo(bot, targets);
}

export default createMineflayerMoveToState;

