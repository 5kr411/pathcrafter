import { MovementGoal, goalToBaritoneGoal, positionToGoal } from './movementTypes';
import logger from '../utils/logger';

interface Bot {
  entity?: any;
  ashfinder?: any;
  [key: string]: any;
}

interface Targets {
  position?: any;
  goal?: MovementGoal;
  baritoneTimeout?: number;
  [key: string]: any;
}

class BehaviorBaritoneMoveTo {
  private bot: Bot;
  private targets: Targets;
  private finished: boolean;
  private startTime: number | null;
  private timeout: number;
  private goalReached: boolean;
  private pathFailed: boolean;
  private _distance: number;
  private goalReachHandler: (() => void) | null;
  private stoppedHandler: (() => void) | null;
  public stateName: string;
  public active: boolean;

  constructor(bot: Bot, targets: Targets) {
    this.bot = bot;
    this.targets = targets;
    this.stateName = 'BehaviorBaritoneMoveTo';
    this.active = false;
    this.finished = false;
    this.startTime = null;
    this.timeout = targets.baritoneTimeout || 10000;
    this.goalReached = false;
    this.pathFailed = false;
    this._distance = 0;
    this.goalReachHandler = null;
    this.stoppedHandler = null;
  }

  get distance(): number {
    return this._distance;
  }

  set distance(value: number) {
    this._distance = value;
  }

  onStateEntered(): void {
    this.active = true;
    this.finished = false;
    this.goalReached = false;
    this.pathFailed = false;
    this.startTime = Date.now();

    if (!this.bot.ashfinder) {
      logger.error('BehaviorBaritoneMoveTo: ashfinder not available on bot');
      this.finished = true;
      this.pathFailed = true;
      return;
    }

    try {
      const baritoneGoals = require('@miner-org/mineflayer-baritone').goals;
      let goal = null;

      if (this.targets.goal) {
        goal = goalToBaritoneGoal(this.targets.goal, baritoneGoals);
      } else if (this.targets.position) {
        const movementGoal = positionToGoal(this.targets.position, this._distance);
        if (movementGoal) {
          goal = goalToBaritoneGoal(movementGoal, baritoneGoals);
        }
      }

      if (!goal) {
        logger.error('BehaviorBaritoneMoveTo: no valid goal to navigate to');
        this.finished = true;
        this.pathFailed = true;
        return;
      }

      this.goalReachHandler = () => {
        if (!this.active) {
          logger.debug('BehaviorBaritoneMoveTo: ignoring goal-reach event (behavior inactive)');
          return;
        }
        
        const actualDistance = this.distanceToTarget();
        const acceptableDistance = this._distance || 3.5;
        
        if (actualDistance <= acceptableDistance) {
          logger.info(`BehaviorBaritoneMoveTo: goal reached (distance: ${actualDistance.toFixed(2)})`);
          this.goalReached = true;
          this.finished = true;
        } else {
          logger.warn(`BehaviorBaritoneMoveTo: baritone reported goal-reach but bot is ${actualDistance.toFixed(2)} blocks away (acceptable: ${acceptableDistance})`);
          this.pathFailed = true;
          this.finished = true;
        }
        this.cleanup();
      };

      this.stoppedHandler = () => {
        if (!this.active) {
          logger.debug('BehaviorBaritoneMoveTo: ignoring stopped event (behavior inactive)');
          return;
        }
        
        if (!this.goalReached) {
          logger.warn('BehaviorBaritoneMoveTo: pathfinding stopped before reaching goal');
          this.pathFailed = true;
          this.finished = true;
        }
        this.cleanup();
      };

      this.bot.ashfinder.on('goal-reach', this.goalReachHandler);
      this.bot.ashfinder.on('stopped', this.stoppedHandler);

      logger.info('BehaviorBaritoneMoveTo: starting baritone pathfinding');
      this.bot.ashfinder.goto(goal).catch((err: any) => {
        if (this.active) {
          logger.error(`BehaviorBaritoneMoveTo: pathfinding error: ${err.message}`);
          this.pathFailed = true;
          this.finished = true;
        }
        this.cleanup();
      });
    } catch (err: any) {
      logger.error(`BehaviorBaritoneMoveTo: error setting up pathfinding: ${err.message}`);
      this.finished = true;
      this.pathFailed = true;
    }
  }

  onStateExited(): void {
    this.active = false;
    
    if (this.bot.ashfinder && !this.finished) {
      try {
        this.bot.ashfinder.stop();
      } catch (err: any) {
        logger.warn(`BehaviorBaritoneMoveTo: error stopping pathfinding: ${err.message}`);
      }
    }
    
    this.cleanup();
  }
  
  private cleanup(): void {
    if (this.bot.ashfinder && this.goalReachHandler) {
      this.bot.ashfinder.removeListener('goal-reach', this.goalReachHandler);
      this.goalReachHandler = null;
    }
    if (this.bot.ashfinder && this.stoppedHandler) {
      this.bot.ashfinder.removeListener('stopped', this.stoppedHandler);
      this.stoppedHandler = null;
    }
  }

  isFinished(): boolean {
    if (this.finished) {
      return true;
    }

    if (this.startTime && Date.now() - this.startTime > this.timeout) {
      logger.warn('BehaviorBaritoneMoveTo: timeout exceeded');
      this.finished = true;
      this.pathFailed = true;
      this.cleanup();
      if (this.bot.ashfinder) {
        try {
          this.bot.ashfinder.stop();
        } catch (err: any) {
          logger.debug(`BehaviorBaritoneMoveTo: error stopping on timeout: ${err.message}`);
        }
      }
      return true;
    }

    return false;
  }

  didSucceed(): boolean {
    return this.goalReached;
  }

  didFail(): boolean {
    return this.pathFailed;
  }

  distanceToTarget(): number {
    if (!this.targets.position || !this.bot.entity?.position) {
      return Infinity;
    }

    const botPos = this.bot.entity.position;
    const targetPos = this.targets.position;
    
    const dx = botPos.x - targetPos.x;
    const dy = botPos.y - targetPos.y;
    const dz = botPos.z - targetPos.z;
    
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

function createBaritoneMoveToState(bot: Bot, targets: Targets): BehaviorBaritoneMoveTo {
  return new BehaviorBaritoneMoveTo(bot, targets);
}

export default createBaritoneMoveToState;

