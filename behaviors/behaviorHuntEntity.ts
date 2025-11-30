const {
  StateTransition,
  BehaviorIdle,
  BehaviorGetClosestEntity,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { BehaviorPvpAttack } from './behaviorPvpAttack';

interface Bot {
  entity?: {
    position: any;
    health?: number;
    yaw: number;
    pitch: number;
  };
  entities?: Record<string, any>;
  pvp?: any;
  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  [key: string]: any;
}

interface Entity {
  position?: any;
  health?: number;
  name?: string;
  displayName?: string;
  id?: number;
  isAlive?: () => boolean;
  [key: string]: any;
}

interface Targets {
  entity?: Entity | null;
  entityFilter?: (entity: Entity) => boolean;
  detectionRange?: number;
  attackRange?: number;
  followRange?: number;
  [key: string]: any;
}

/**
 * Hunt entity behavior - uses mineflayer-pvp for combat
 * Attacks continuously until entity is dead, despawned, or timeout
 */
function createHuntEntityState(bot: Bot, targets: Targets): any {
  const HUNT_TIMEOUT = 60000; // 1 minute
  let huntStartTime = 0;
  let huntTimeoutId: NodeJS.Timeout | null = null;
  let targetEntity: Entity | null | undefined = null;
  let handleEntityGone: ((entity: any) => void) | null = null;
  let pvpAttackState: BehaviorPvpAttack | null = null;

  const enter = new BehaviorIdle();
  
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

  pvpAttackState = new BehaviorPvpAttack(bot, targets, {
    attackRange: targets.attackRange ?? 3.0,
    followRange: targets.followRange ?? 2.0,
    viewDistance: targets.detectionRange ?? 48,
    onStopped: (reason) => {
      logger.info(`BehaviorHuntEntity: pvp stopped - reason: ${reason}`);
    }
  });

  const exit = new BehaviorIdle();

  const setupEntityTracking = () => {
    if (targets.entity && !targetEntity) {
      targetEntity = targets.entity;
      logger.info(`BehaviorHuntEntity: captured entity reference: ${targetEntity.name || targetEntity.displayName || 'unknown'}`);
      
      if (!handleEntityGone) {
        handleEntityGone = (gone: any) => {
          if (targetEntity && gone?.id === (targetEntity as any).id) {
            logger.info(`BehaviorHuntEntity: entity ${targetEntity.name || 'target'} despawned/defeated`);
            targetEntity = null;
            targets.entity = null;
          }
        };
        bot.on('entityGone', handleEntityGone);
      }
    }
  };

  const cleanupEntityTracking = () => {
    if (handleEntityGone) {
      try {
        if (bot.off) {
          bot.off('entityGone', handleEntityGone);
        } else {
          bot.removeListener('entityGone', handleEntityGone);
        }
      } catch {}
      handleEntityGone = null;
    }
  };

  const clearHuntTimeout = () => {
    if (huntTimeoutId) {
      clearTimeout(huntTimeoutId);
      huntTimeoutId = null;
    }
  };

  const startHuntTimeout = () => {
    clearHuntTimeout();
    huntTimeoutId = setTimeout(() => {
      logger.info('BehaviorHuntEntity: hunt timed out after 1 minute');
      if (pvpAttackState) {
        pvpAttackState.forceStop();
      }
    }, HUNT_TIMEOUT);
  };

  const enterToFind = new StateTransition({
    parent: enter,
    child: findEntity,
    name: 'BehaviorHuntEntity: enter -> find entity',
    shouldTransition: () => !targets.entity,
    onTransition: () => {
      huntStartTime = Date.now();
      startHuntTimeout();
      logger.info('BehaviorHuntEntity: no entity provided, searching');
    }
  });

  const enterToPvpAttack = new StateTransition({
    parent: enter,
    child: pvpAttackState,
    name: 'BehaviorHuntEntity: enter -> pvp attack',
    shouldTransition: () => !!targets.entity,
    onTransition: () => {
      huntStartTime = Date.now();
      startHuntTimeout();
      setupEntityTracking();
      logger.info('BehaviorHuntEntity: entity provided, starting pvp attack');
    }
  });

  const findToPvpAttack = new StateTransition({
    parent: findEntity,
    child: pvpAttackState,
    name: 'BehaviorHuntEntity: find -> pvp attack',
    shouldTransition: () => {
      if (typeof findEntity.isFinished === 'function') {
        return findEntity.isFinished() && targets.entity !== null;
      }
      return targets.entity !== null;
    },
    onTransition: () => {
      setupEntityTracking();
      logger.info('BehaviorHuntEntity: entity found, starting pvp attack');
    }
  });

  const findToExit = new StateTransition({
    parent: findEntity,
    child: exit,
    name: 'BehaviorHuntEntity: find -> exit (no entity found)',
    shouldTransition: () => {
      if (typeof findEntity.isFinished === 'function') {
        return findEntity.isFinished() && targets.entity === null;
      }
      return false;
    },
    onTransition: () => {
      clearHuntTimeout();
      cleanupEntityTracking();
      logger.info('BehaviorHuntEntity: no entity found, exiting');
    }
  });

  const pvpAttackToExit = new StateTransition({
    parent: pvpAttackState,
    child: exit,
    name: 'BehaviorHuntEntity: pvp attack -> exit',
    shouldTransition: () => {
      return pvpAttackState!.isFinished();
    },
    onTransition: () => {
      clearHuntTimeout();
      const elapsed = Date.now() - huntStartTime;
      
      if (targetEntity) {
        logger.info(`BehaviorHuntEntity: entity eliminated after ${(elapsed / 1000).toFixed(1)}s`);
      } else {
        logger.info(`BehaviorHuntEntity: hunt complete after ${(elapsed / 1000).toFixed(1)}s`);
      }
      
      targets.entity = null;
      targetEntity = null;
      cleanupEntityTracking();
    }
  });

  const transitions = [
    enterToFind,
    enterToPvpAttack,
    findToPvpAttack,
    findToExit,
    pvpAttackToExit
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  addStateLogging(stateMachine, 'HuntEntity', {
    logEnter: true,
    logExit: true,
    getExtraInfo: () => {
      if (targetEntity) {
        const elapsed = Date.now() - huntStartTime;
        return `hunting ${targetEntity.name || targetEntity.displayName || 'entity'} (${(elapsed / 1000).toFixed(1)}s)`;
      }
      return 'no target';
    }
  });

  const originalStateExit = stateMachine.onStateExited;
  stateMachine.onStateExited = function(...args: any[]) {
    clearHuntTimeout();
    cleanupEntityTracking();
    
    if (pvpAttackState) {
      pvpAttackState.forceStop();
    }
    
    if (originalStateExit) {
      return originalStateExit.apply(this, args);
    }
  };

  return stateMachine;
}

export default createHuntEntityState;
