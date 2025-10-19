import createSmartMoveToState from './behaviorSmartMoveTo';
import { createXZGoal, createXZNearGoal } from './movementTypes';

interface Bot {
  entity?: any;
  [key: string]: any;
}

interface Targets {
  position?: any;
  distance?: number;
  [key: string]: any;
}

function createSmartMoveXZState(bot: Bot, targets: Targets): any {
  if (targets.position) {
    if (targets.distance !== undefined && targets.distance > 0) {
      targets.goal = createXZNearGoal(targets.position, targets.distance);
    } else {
      targets.goal = createXZGoal(targets.position);
    }
  }
  
  return createSmartMoveToState(bot, targets);
}

export default createSmartMoveXZState;

