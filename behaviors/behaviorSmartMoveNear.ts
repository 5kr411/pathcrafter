import createSmartMoveToState from './behaviorSmartMoveTo';
import { createNearGoal } from './movementTypes';

interface Bot {
  entity?: any;
  [key: string]: any;
}

interface Targets {
  position?: any;
  distance?: number;
  [key: string]: any;
}

function createSmartMoveNearState(bot: Bot, targets: Targets): any {
  if (targets.position && targets.distance !== undefined) {
    targets.goal = createNearGoal(targets.position, targets.distance);
  } else if (targets.position) {
    targets.goal = createNearGoal(targets.position, 3);
  }
  
  return createSmartMoveToState(bot, targets);
}

export default createSmartMoveNearState;

