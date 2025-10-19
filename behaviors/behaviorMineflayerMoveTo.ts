const { BehaviorMoveTo } = require('mineflayer-statemachine');
import { MovementGoal, goalToMineflayerPosition } from './movementTypes';

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
  private targets: Targets;
  private moveTo: any;
  public stateName: string;
  public active: boolean;

  constructor(bot: Bot, targets: Targets) {
    this.targets = targets;
    this.stateName = 'BehaviorMineflayerMoveTo';
    this.active = false;
    
    this.moveTo = new BehaviorMoveTo(bot, targets);
  }

  get distance(): number {
    return this.moveTo.distance;
  }

  set distance(value: number) {
    this.moveTo.distance = value;
  }

  get movements(): any {
    return this.moveTo.movements;
  }

  set movements(value: any) {
    this.moveTo.movements = value;
  }

  onStateEntered(): void {
    if (this.targets.goal && !this.targets.position) {
      const position = goalToMineflayerPosition(this.targets.goal);
      if (position) {
        this.targets.position = position;
      }
    }
    
    if (this.moveTo.onStateEntered) {
      this.moveTo.onStateEntered();
    }
    this.active = true;
  }

  onStateExited(): void {
    if (this.moveTo.onStateExited) {
      this.moveTo.onStateExited();
    }
    this.active = false;
  }

  isFinished(): boolean {
    if (this.moveTo.isFinished) {
      return this.moveTo.isFinished();
    }
    return false;
  }

  distanceToTarget(): number {
    if (this.moveTo.distanceToTarget) {
      return this.moveTo.distanceToTarget();
    }
    return Infinity;
  }
}

function createMineflayerMoveToState(bot: Bot, targets: Targets): BehaviorMineflayerMoveTo {
  return new BehaviorMineflayerMoveTo(bot, targets);
}

export default createMineflayerMoveToState;

