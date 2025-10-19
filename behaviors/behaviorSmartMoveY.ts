import createSmartMoveToState from './behaviorSmartMoveTo';
import { createYGoal } from './movementTypes';

interface Bot {
  entity?: any;
  [key: string]: any;
}

interface Targets {
  y?: number;
  [key: string]: any;
}

function createSmartMoveYState(bot: Bot, targets: Targets): any {
  if (targets.y !== undefined) {
    targets.goal = createYGoal(targets.y);
  }
  
  return createSmartMoveToState(bot, targets);
}

export default createSmartMoveYState;

