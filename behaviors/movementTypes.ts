interface Vec3Like {
  x: number;
  y: number;
  z: number;
  [key: string]: any;
}

export type MovementGoalType = 'exact' | 'near' | 'y' | 'xz' | 'xz-near';

export interface MovementGoal {
  type: MovementGoalType;
  position?: Vec3Like;
  distance?: number;
  y?: number;
}

export function createExactGoal(position: Vec3Like): MovementGoal {
  return {
    type: 'exact',
    position
  };
}

export function createNearGoal(position: Vec3Like, distance: number): MovementGoal {
  return {
    type: 'near',
    position,
    distance
  };
}

export function createYGoal(y: number): MovementGoal {
  return {
    type: 'y',
    y
  };
}

export function createXZGoal(position: Vec3Like): MovementGoal {
  return {
    type: 'xz',
    position
  };
}

export function createXZNearGoal(position: Vec3Like, distance: number): MovementGoal {
  return {
    type: 'xz-near',
    position,
    distance
  };
}

export function goalToMineflayerPosition(goal: MovementGoal): Vec3Like | null {
  if (goal.type === 'y') {
    return null;
  }
  return goal.position || null;
}

export function goalToBaritoneGoal(goal: MovementGoal, baritoneGoals: any): any {
  const { Vec3 } = require('vec3');
  
  switch (goal.type) {
    case 'exact':
      if (!goal.position) return null;
      return new baritoneGoals.GoalExact(new Vec3(goal.position.x, goal.position.y, goal.position.z));
    
    case 'near':
      if (!goal.position || goal.distance === undefined) return null;
      return new baritoneGoals.GoalNear(
        new Vec3(goal.position.x, goal.position.y, goal.position.z),
        goal.distance
      );
    
    case 'y':
      if (goal.y === undefined) return null;
      return new baritoneGoals.GoalYLevel(goal.y);
    
    case 'xz':
      if (!goal.position) return null;
      return new baritoneGoals.GoalXZ(new Vec3(goal.position.x, goal.position.y, goal.position.z));
    
    case 'xz-near':
      if (!goal.position || goal.distance === undefined) return null;
      return new baritoneGoals.GoalXZNear(
        new Vec3(goal.position.x, goal.position.y, goal.position.z),
        goal.distance
      );
    
    default:
      return null;
  }
}

export function positionToGoal(position: Vec3Like | null, distance?: number): MovementGoal | null {
  if (!position) return null;
  
  if (distance !== undefined && distance > 0) {
    return createNearGoal(position, distance);
  }
  
  return createExactGoal(position);
}

