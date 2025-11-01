const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import createFollowAndAttackEntityState from './behaviorFollowAndAttackEntity';

interface Bot {
  entity?: {
    position: any;
    health?: number;
    yaw: number;
    pitch: number;
  };
  entities?: Record<string, any>;
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

function isEntityAlive(entity: Entity | null | undefined): boolean {
  if (!entity) return false;
  if (typeof entity.isAlive === 'function') {
    return entity.isAlive();
  }
  if (typeof entity.health === 'number') {
    return entity.health > 0;
  }
  return true;
}

/**
 * Hunt entity behavior - keeps attacking until entity is dead or timeout
 * Wraps follow-and-attack in a loop with 1 minute timeout
 */
function createHuntEntityState(bot: Bot, targets: Targets): any {
  const HUNT_TIMEOUT = 60000; // 1 minute
  let huntStartTime = 0;
  let targetEntity: Entity | null | undefined = null;

  const enter = new BehaviorIdle();
  const followAndAttack = createFollowAndAttackEntityState(bot, targets);
  const exit = new BehaviorIdle();
  
  // Save entity reference whenever it becomes available
  const originalUpdate = followAndAttack.update;
  followAndAttack.update = function() {
    if (targets.entity && !targetEntity) {
      targetEntity = targets.entity;
      logger.info(`BehaviorHuntEntity: captured entity reference: ${targetEntity.name}`);
    }
    if (originalUpdate) {
      return originalUpdate.call(this);
    }
  };

  const enterToFollowAttack = new StateTransition({
    parent: enter,
    child: followAndAttack,
    name: 'BehaviorHuntEntity: enter -> follow-attack',
    shouldTransition: () => true,
    onTransition: () => {
      huntStartTime = Date.now();
      logger.info('BehaviorHuntEntity: starting hunt');
    }
  });

  // Loop back to follow-attack if entity is still alive and not timed out
  const followAttackToFollowAttack = new StateTransition({
    parent: followAndAttack,
    child: followAndAttack,
    name: 'BehaviorHuntEntity: follow-attack -> follow-attack (continue hunt)',
    shouldTransition: () => {
      // Check if the follow-attack cycle completed
      const finished = typeof followAndAttack.isFinished === 'function' 
        ? followAndAttack.isFinished() 
        : followAndAttack.isFinished === true;
      
      if (!finished) return false;
      
      // Check timeout
      const elapsed = Date.now() - huntStartTime;
      if (elapsed > HUNT_TIMEOUT) {
        logger.info(`BehaviorHuntEntity: not looping - timeout (${elapsed}ms > ${HUNT_TIMEOUT}ms)`);
        return false;
      }

      // If entity is still alive, continue hunting
      const entityAlive = targetEntity && isEntityAlive(targetEntity);
      logger.info(`BehaviorHuntEntity: loop check - entity: ${!!targetEntity}, alive: ${entityAlive}`);
      if (entityAlive) {
        return true;
      }
      
      return false;
    },
    onTransition: () => {
      // Restore entity reference for next attack cycle
      targets.entity = targetEntity;
      logger.info('BehaviorHuntEntity: entity still alive, continuing hunt');
    }
  });

  // Exit if entity is dead or timeout
  const followAttackToExit = new StateTransition({
    parent: followAndAttack,
    child: exit,
    name: 'BehaviorHuntEntity: follow-attack -> exit (hunt complete)',
    shouldTransition: () => {
      const finished = typeof followAndAttack.isFinished === 'function' 
        ? followAndAttack.isFinished() 
        : followAndAttack.isFinished === true;
      
      if (!finished) return false;
      
      // Exit if timeout reached
      const elapsed = Date.now() - huntStartTime;
      if (elapsed > HUNT_TIMEOUT) {
        return true;
      }
      
      // Exit if entity is dead or lost
      if (!targetEntity || !isEntityAlive(targetEntity)) {
        return true;
      }
      
      return false;
    },
    onTransition: () => {
      const elapsed = Date.now() - huntStartTime;
      if (elapsed > HUNT_TIMEOUT) {
        logger.info('BehaviorHuntEntity: hunt timed out after 1 minute');
      } else if (!targetEntity || !isEntityAlive(targetEntity)) {
        logger.info('BehaviorHuntEntity: entity eliminated');
      } else {
        logger.info('BehaviorHuntEntity: hunt complete');
      }
      targets.entity = null;
      targetEntity = null;
    }
  });

  const transitions = [
    enterToFollowAttack,
    followAttackToFollowAttack,
    followAttackToExit
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  addStateLogging(stateMachine, 'HuntEntity', {
    logEnter: true,
    logExit: true,
    getExtraInfo: () => {
      if (targetEntity) {
        const elapsed = Date.now() - huntStartTime;
        return `hunting ${targetEntity.name || 'entity'} (${(elapsed / 1000).toFixed(1)}s)`;
      }
      return 'no target';
    }
  });

  return stateMachine;
}

export default createHuntEntityState;

