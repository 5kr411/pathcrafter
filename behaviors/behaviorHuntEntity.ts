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

function isEntityAlive(bot: Bot, entity: Entity | null | undefined): boolean {
  if (!entity) return false;
  
  // Check health FIRST - most reliable indicator
  if (typeof entity.health === 'number') {
    return entity.health > 0;
  }
  
  // Check if entity has isAlive method
  if (typeof entity.isAlive === 'function') {
    return entity.isAlive();
  }
  
  // Check if entity is still in bot.entities (removed when killed/despawned)
  if (bot.entities && entity.id) {
    const stillExists = Object.values(bot.entities).some((e: any) => e.id === entity.id);
    if (!stillExists) {
      return false;
    }
  }
  
  // If we have an entity reference but can't determine state, assume alive and let combat continue
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
  (targets as any).followStuck = false;
  let handleEntityGone: ((entity: any) => void) | null = null;

  const enter = new BehaviorIdle();
  const followAndAttack = createFollowAndAttackEntityState(bot, targets);
  const exit = new BehaviorIdle();
  
  // Save entity reference whenever it becomes available
  const originalUpdate = followAndAttack.update;
  followAndAttack.update = function() {
    if (targets.entity && !targetEntity) {
      targetEntity = targets.entity;
      logger.info(`BehaviorHuntEntity: captured entity reference: ${targetEntity.name}`);
      if (!handleEntityGone) {
        handleEntityGone = (gone: any) => {
          if (targetEntity && gone?.id === (targetEntity as any).id) {
            logger.info(`BehaviorHuntEntity: entity ${targetEntity.name} despawned/defeated`);
            targetEntity = null;
            targets.entity = null;
          }
        };
        bot.on('entityGone', handleEntityGone);
      }
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

      if ((targets as any).followStuck) {
        logger.warn('BehaviorHuntEntity: follow step reported stuck, aborting hunt loop');
        targetEntity = null;
        return false;
      }
      
      // Check timeout
      const elapsed = Date.now() - huntStartTime;
      if (elapsed > HUNT_TIMEOUT) {
        logger.info(`BehaviorHuntEntity: not looping - timeout (${elapsed}ms > ${HUNT_TIMEOUT}ms)`);
        return false;
      }

      // If entity is still alive, continue hunting
      const entityAlive = targetEntity && isEntityAlive(bot, targetEntity);
      const health = targetEntity?.health ?? 'unknown';
      logger.info(`BehaviorHuntEntity: loop check - entity: ${!!targetEntity}, alive: ${entityAlive}, health: ${health}`);
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

      if ((targets as any).followStuck) {
        return true;
      }
      
      // Exit if timeout reached
      const elapsed = Date.now() - huntStartTime;
      if (elapsed > HUNT_TIMEOUT) {
        return true;
      }
      
      // Exit if entity is dead or lost
      if (!targetEntity || !isEntityAlive(bot, targetEntity)) {
        return true;
      }
      
      return false;
    },
    onTransition: () => {
      const elapsed = Date.now() - huntStartTime;
      const wasStuck = (targets as any).followStuck === true;
      if (wasStuck) {
        logger.warn('BehaviorHuntEntity: aborting hunt because path to target is blocked');
      } else if (elapsed > HUNT_TIMEOUT) {
        logger.info('BehaviorHuntEntity: hunt timed out after 1 minute');
      } else if (!targetEntity || !isEntityAlive(bot, targetEntity)) {
        logger.info('BehaviorHuntEntity: entity eliminated');
      } else {
        logger.info('BehaviorHuntEntity: hunt complete');
      }
      targets.entity = null;
      targetEntity = null;
      (targets as any).followStuck = false;
      if (handleEntityGone) {
        bot.removeListener('entityGone', handleEntityGone);
        handleEntityGone = null;
      }
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

  const originalStateExit = stateMachine.onStateExited;
  stateMachine.onStateExited = function(...args: any[]) {
    if (handleEntityGone) {
      bot.removeListener('entityGone', handleEntityGone);
      handleEntityGone = null;
    }
    if (originalStateExit) {
      return originalStateExit.apply(this, args);
    }
  };

  return stateMachine;
}

export default createHuntEntityState;

