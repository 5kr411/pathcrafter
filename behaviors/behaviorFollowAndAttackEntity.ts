const {
  StateTransition,
  BehaviorIdle,
  BehaviorGetClosestEntity,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import createAttackEntityState from './behaviorAttackEntity';
import { BehaviorSafeFollowEntity } from './behaviorSafeFollowEntity';

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
  if (bot?.entities && entity) {
    const entityId = (entity as any)?.id;
    if (entityId !== undefined && entityId !== null) {
      if (!bot.entities[entityId]) return false;
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

  // Disable smart-move unsticking while chasing moving entities; it tends to fight follow logic
  (targets as any).disableSmartMoveUnstick = true;
  (targets as any).followStuck = false;

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
  const followEntity = new BehaviorSafeFollowEntity(bot, targets);
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
      return `following entity at distance ${dist}m, target range: ${DEFAULT_ATTACK_RANGE.toFixed(1)}m`;
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

      // Use actual bot-to-entity distance, not pathfinding distance
      const distance = getDistanceToEntity(bot, targets.entity);

      return distance < DEFAULT_ATTACK_RANGE;
    },
    onTransition: () => {
      const distance = targets.entity ? getDistanceToEntity(bot, targets.entity) : 0;
      logger.info(`BehaviorFollowAndAttackEntity: within ${DEFAULT_ATTACK_RANGE.toFixed(1)} block range at distance ${distance.toFixed(2)}, attacking`);
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
      targets.entity = null;
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
    
    if ('smartMoveStuckCount' in targets) {
      delete (targets as any).smartMoveStuckCount;
    }
    if ('lastSmartMoveStuck' in targets) {
      delete (targets as any).lastSmartMoveStuck;
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
