const {
  StateTransition,
  BehaviorIdle,
  BehaviorFollowEntity,
  BehaviorGetClosestEntity,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import createAttackEntityState from './behaviorAttackEntity';

interface Bot {
  version?: string;
  entity?: {
    position: any;
    health?: number;
    yaw: number;
    pitch: number;
  };
  entities?: Record<string, any>;
  clearControlStates?: () => void;
  lookAt?: (position: any, force?: boolean, callback?: () => void) => void;
  [key: string]: any;
}

interface Entity {
  position?: any;
  health?: number;
  isAlive?: () => boolean;
  [key: string]: any;
}

interface Targets {
  entity?: Entity | null;
  entityFilter?: (entity: Entity) => boolean;
  detectionRange?: number;
  attackRange?: number;
  [key: string]: any;
}

function getDistanceToEntity(bot: Bot, entity: Entity): number {
  if (!bot.entity?.position || !entity?.position || !bot.entity.position.distanceTo) {
    return Infinity;
  }
  return bot.entity.position.distanceTo(entity.position);
}

function isEntityApproaching(bot: Bot, entity: Entity, lastPos: any, currentPos: any): boolean | null {
  if (!bot.entity?.position || !entity?.position || !lastPos || !currentPos) {
    return null;
  }

  // Calculate entity's movement vector
  const movementX = currentPos.x - lastPos.x;
  const movementY = currentPos.y - lastPos.y;
  const movementZ = currentPos.z - lastPos.z;
  const movementMagnitude = Math.sqrt(movementX * movementX + movementY * movementY + movementZ * movementZ);

  // Entity not moving (positions are identical)
  if (movementMagnitude < 0.001) {
    return null;
  }

  // Calculate vector from entity's current position to bot
  const toBotX = bot.entity.position.x - currentPos.x;
  const toBotY = bot.entity.position.y - currentPos.y;
  const toBotZ = bot.entity.position.z - currentPos.z;

  // Dot product: positive = approaching, negative = fleeing
  const dotProduct = (movementX * toBotX) + (movementY * toBotY) + (movementZ * toBotZ);

  return dotProduct > 0;
}

function isEntityAlive(bot: Bot, entity: Entity | null | undefined): boolean {
  if (!entity) return false;

  // If the entity exposes an isAlive hook, respect it
  if (typeof entity.isAlive === 'function') {
    try {
      if (!entity.isAlive()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  // Health metadata
  if (typeof entity.health === 'number' && entity.health <= 0) {
    return false;
  }

  // Ensure the entity is still being tracked by the bot – once despawned/defeated
  // Mineflayer removes it from bot.entities.
  if (bot?.entities && entity && Object.keys(bot.entities).length > 0) {
    const entityId = (entity as any)?.id;
    if (entityId !== undefined && entityId !== null) {
      const tracked = Object.values(bot.entities).find((candidate: any) => candidate?.id === entityId);
      if (!tracked) {
        return false;
      }
    }
  }

  return true;
}


/**
 * Creates a follow-and-attack state that does ONE cycle only:
 * enter -> (find if needed) -> follow -> attack -> exit
 * 
 * No looping back to follow or find. Simple one-shot behavior.
 */
function createFollowAndAttackEntityState(bot: Bot, targets: Targets): any {
  const MAX_STATIONARY_ATTACK_RANGE = 2.8; // Keep some buffer below melee limit
  const DEFAULT_ATTACK_RANGE = Math.min(targets.attackRange ?? MAX_STATIONARY_ATTACK_RANGE, MAX_STATIONARY_ATTACK_RANGE);
  const ATTACK_RANGE_APPROACHING = DEFAULT_ATTACK_RANGE; // Entity moving towards bot
  const ATTACK_RANGE_FLEEING = Math.min(1.5, Math.max(0.8, DEFAULT_ATTACK_RANGE - 0.8)); // Entity moving away from bot

  // Disable smart-move unsticking while chasing moving entities; it tends to fight follow logic
  (targets as any).disableSmartMoveUnstick = true;
  (targets as any).followStuck = false;

  // Track entity position from last tick for real-time movement detection
  let lastTickPosition: any = null;
  let currentTickPosition: any = null;

  const enter = new BehaviorIdle();

  // Optional: find entity if not provided
  // Wrap in a function that reads the filter dynamically from targets
  const findEntity = new BehaviorGetClosestEntity(bot, targets, (entity: Entity) => {
    if (targets.entityFilter) {
      return targets.entityFilter(entity);
    }
    return true;
  });

  addStateLogging(findEntity, 'GetClosestEntity', {
    logEnter: true,
    getExtraInfo: () => 'searching for target entity'
  });

  // Follow entity until within attack range
  const followEntity = new BehaviorFollowEntity(bot, targets);
  followEntity.followDistance = Math.max(0.2, DEFAULT_ATTACK_RANGE - 0.4);
  
  // Configure follow to stop at ATTACK_RANGE distance
  if (followEntity.movements) {
    followEntity.movements.canDig = false;
  }

  addStateLogging(followEntity, 'FollowEntity', {
    logEnter: true,
    logExit: true,
    getExtraInfo: () => {
      const entity = targets.entity;
      if (!entity?.position) return 'no entity';
      const botPos = bot.entity?.position;
      if (!botPos || !botPos.distanceTo) return 'following entity';
      const dist = botPos.distanceTo(entity.position).toFixed(2);
      
      const approaching = isEntityApproaching(bot, entity, lastTickPosition, currentTickPosition);
      const attackRange = approaching === true ? ATTACK_RANGE_APPROACHING : 
                         approaching === false ? ATTACK_RANGE_FLEEING : 
                         DEFAULT_ATTACK_RANGE;
      
      const movementDesc = approaching === true ? '(approaching)' : 
                          approaching === false ? '(fleeing)' : 
                          '(stationary)';
      
      return `following entity at distance ${dist}m, target range: ${attackRange.toFixed(1)}m ${movementDesc}`;
    }
  });

  // Attack entity (includes rotation and distance check)
  const attackEntity = createAttackEntityState(bot, targets);

  addStateLogging(attackEntity, 'AttackEntity', {
    logEnter: true,
    getExtraInfo: () => {
      const entity = targets.entity;
      if (!entity) return 'no entity';
      const distance = getDistanceToEntity(bot, entity);
      return `attacking entity at distance ${distance.toFixed(2)}m`;
    }
  });

  const exit = new BehaviorIdle();

  // Transition: enter -> find (if no entity provided)
  const enterToFind = new StateTransition({
    parent: enter,
    child: findEntity,
    name: 'BehaviorFollowAndAttackEntity: enter -> find entity',
    shouldTransition: () => !targets.entity,
    onTransition: () => {
      logger.info('BehaviorFollowAndAttackEntity: no entity provided, searching');
    }
  });

  // Transition: enter -> follow (if entity already provided)
  const enterToFollow = new StateTransition({
    parent: enter,
    child: followEntity,
    name: 'BehaviorFollowAndAttackEntity: enter -> follow',
    shouldTransition: () => !!targets.entity && isEntityAlive(bot, targets.entity),
    onTransition: () => {
      // Initialize position tracking only if not already tracking
      if (!lastTickPosition && targets.entity?.position) {
        currentTickPosition = targets.entity.position.clone();
        lastTickPosition = currentTickPosition.clone();
      }
      if ('smartMoveStuckCount' in targets) {
        delete (targets as any).smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in targets) {
        delete (targets as any).lastSmartMoveStuck;
      }
      (targets as any).followStuck = false;
      logger.info('BehaviorFollowAndAttackEntity: entity provided, starting follow');
    }
  });

  // Transition: enter -> exit (if entity provided but dead/invalid)
  const enterToExit = new StateTransition({
    parent: enter,
    child: exit,
    name: 'BehaviorFollowAndAttackEntity: enter -> exit (no valid entity)',
    shouldTransition: () => targets.entity !== null && targets.entity !== undefined && !isEntityAlive(bot, targets.entity),
    onTransition: () => {
      logger.info('BehaviorFollowAndAttackEntity: entity not valid, exiting');
      targets.entity = null;
    }
  });

  // Transition: find -> follow (entity found)
  const findToFollow = new StateTransition({
    parent: findEntity,
    child: followEntity,
    name: 'BehaviorFollowAndAttackEntity: find -> follow',
    shouldTransition: () => {
      if (typeof findEntity.isFinished === 'function') {
        return findEntity.isFinished() && targets.entity !== null && isEntityAlive(bot, targets.entity);
      }
      return targets.entity !== null && isEntityAlive(bot, targets.entity);
    },
    onTransition: () => {
      // Initialize position tracking only if not already tracking
      if (!lastTickPosition && targets.entity?.position) {
        currentTickPosition = targets.entity.position.clone();
        lastTickPosition = currentTickPosition.clone();
      }
      if ('smartMoveStuckCount' in targets) {
        delete (targets as any).smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in targets) {
        delete (targets as any).lastSmartMoveStuck;
      }
      (targets as any).followStuck = false;
      logger.info('BehaviorFollowAndAttackEntity: entity found, following');
    }
  });

  // Transition: find -> exit (no entity found)
  const findToExit = new StateTransition({
    parent: findEntity,
    child: exit,
    name: 'BehaviorFollowAndAttackEntity: find -> exit (no entity found)',
    shouldTransition: () => {
      if (typeof findEntity.isFinished === 'function') {
        return findEntity.isFinished() && (targets.entity === null || !isEntityAlive(bot, targets.entity));
      }
      return targets.entity === null || !isEntityAlive(bot, targets.entity);
    },
    onTransition: () => {
      logger.info('BehaviorFollowAndAttackEntity: no entity found, exiting');
      targets.entity = null;
    }
  });

  // Transition: follow -> attack (within attack range)
  const followToAttack = new StateTransition({
    parent: followEntity,
    child: attackEntity,
    name: 'BehaviorFollowAndAttackEntity: follow -> attack',
    shouldTransition: () => {
      if (!targets.entity) return false;
      if (!isEntityAlive(bot, targets.entity)) return false;
      
      // Update position tracking only when entity actually moves
      if (targets.entity.position) {
        const newPosition = targets.entity.position.clone();
        
        // Only update if position has actually changed
        if (currentTickPosition) {
          const dx = newPosition.x - currentTickPosition.x;
          const dy = newPosition.y - currentTickPosition.y;
          const dz = newPosition.z - currentTickPosition.z;
          const moved = Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || Math.abs(dz) > 0.001;
          
          if (moved) {
            lastTickPosition = currentTickPosition.clone();
            currentTickPosition = newPosition;
          }
        } else {
          // First initialization
          currentTickPosition = newPosition;
        }
      }
      
      // Use actual bot-to-entity distance, not pathfinding distance
      const distance = getDistanceToEntity(bot, targets.entity);
      
      // Determine attack range based on entity movement direction
      const approaching = isEntityApproaching(bot, targets.entity, lastTickPosition, currentTickPosition);
      const attackRange = approaching === true ? ATTACK_RANGE_APPROACHING : 
                         approaching === false ? ATTACK_RANGE_FLEEING : 
                         DEFAULT_ATTACK_RANGE;
      
      const inRange = distance < attackRange;
      
      return inRange;
    },
    onTransition: () => {
      const distance = targets.entity ? getDistanceToEntity(bot, targets.entity) : 0;
      const approaching = isEntityApproaching(bot, targets.entity!, lastTickPosition, currentTickPosition);
      const attackRange = approaching === true ? ATTACK_RANGE_APPROACHING : 
                         approaching === false ? ATTACK_RANGE_FLEEING : 
                         DEFAULT_ATTACK_RANGE;
      const movementDesc = approaching === true ? 'approaching' : 
                          approaching === false ? 'fleeing' : 
                          'stationary';
      logger.info(`BehaviorFollowAndAttackEntity: within ${attackRange.toFixed(1)} block range at distance ${distance.toFixed(2)}, entity ${movementDesc}, attacking`);
    }
  });

  // Transition: follow -> exit (entity lost or dead)
  const followToExit = new StateTransition({
    parent: followEntity,
    child: exit,
    name: 'BehaviorFollowAndAttackEntity: follow -> exit (entity lost)',
    shouldTransition: () => {
      if (!targets.entity) return true;
      return !isEntityAlive(bot, targets.entity);
    },
    onTransition: () => {
      logger.info('BehaviorFollowAndAttackEntity: entity lost during follow, exiting');
      targets.entity = null;
      // Reset position tracking when entity is lost
      lastTickPosition = null;
      currentTickPosition = null;
    }
  });

  const followToStuckExit = new StateTransition({
    parent: followEntity,
    child: exit,
    name: 'BehaviorFollowAndAttackEntity: follow -> exit (stuck)',
    shouldTransition: () => {
      const stuckCount = Number((targets as any).smartMoveStuckCount) || 0;
      return stuckCount > 0;
    },
    onTransition: () => {
      logger.warn('BehaviorFollowAndAttackEntity: aborting follow due to pathfinding failure');
      (targets as any).followStuck = true;
      if ('smartMoveStuckCount' in targets) {
        delete (targets as any).smartMoveStuckCount;
      }
      if ('lastSmartMoveStuck' in targets) {
        delete (targets as any).lastSmartMoveStuck;
      }
      targets.entity = null;
      lastTickPosition = null;
      currentTickPosition = null;
    }
  });

  // Transition: attack -> exit (always exit after attack completes, ONE CYCLE ONLY)
  const attackToExit = new StateTransition({
    parent: attackEntity,
    child: exit,
    name: 'BehaviorFollowAndAttackEntity: attack -> exit',
    shouldTransition: () => {
      if (attackEntity.isFinished && typeof attackEntity.isFinished === 'function') {
        return attackEntity.isFinished();
      }
      return attackEntity.isFinished === true;
    },
    onTransition: () => {
      logger.info('BehaviorFollowAndAttackEntity: attack cycle complete, exiting');
      // Position tracking persists across attack cycles for continuous movement detection
    }
  });

  const transitions = [
    enterToFind,
    enterToFollow,
    enterToExit,
    findToFollow,
    findToExit,
    followToAttack,
    followToStuckExit,
    followToExit,
    attackToExit
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  stateMachine.onStateExited = function() {
    logger.debug('FollowAndAttackEntity: cleaning up on state exit');
    
    if (followEntity && typeof followEntity.onStateExited === 'function') {
      try {
        followEntity.onStateExited();
      } catch (err: any) {
        logger.debug(`FollowAndAttackEntity: error cleaning up followEntity: ${err.message}`);
      }
    }
    
    if (attackEntity && typeof attackEntity.onStateExited === 'function') {
      try {
        attackEntity.onStateExited();
      } catch (err: any) {
        logger.debug(`FollowAndAttackEntity: error cleaning up attackEntity: ${err.message}`);
      }
    }
    
    try {
      bot.clearControlStates?.();
      logger.debug('FollowAndAttackEntity: cleared bot control states');
    } catch (err: any) {
      logger.debug(`FollowAndAttackEntity: error clearing control states: ${err.message}`);
    }
  };

  return stateMachine;
}

export default createFollowAndAttackEntityState;
