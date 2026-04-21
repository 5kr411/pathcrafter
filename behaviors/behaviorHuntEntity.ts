const {
  StateTransition,
  BehaviorIdle,
  BehaviorGetClosestEntity,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { BehaviorPvpAttack } from './behaviorPvpAttack';
import { BehaviorSafeFollowEntity } from './behaviorSafeFollowEntity';

interface Bot {
  entity?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
    position: any;
    health?: number;
    yaw: number;
    pitch: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  entities?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  pvp?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  on: (event: string, listener: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  off: (event: string, listener: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  [key: string]: any;
}

interface Entity {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  position?: any;
  health?: number;
  name?: string;
  displayName?: string;
  id?: number;
  isAlive?: () => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  [key: string]: any;
}

interface Targets {
  entity?: Entity | null;
  entityFilter?: (entity: Entity) => boolean;
  detectionRange?: number;
  attackRange?: number;
  followRange?: number;
  pvpApproachRange?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
  [key: string]: any;
}

/**
 * Hunt entity behavior - uses mineflayer-pvp for combat
 * Attacks continuously until entity is dead, despawned, or timeout
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
function createHuntEntityState(bot: Bot, targets: Targets): any {
  const HUNT_TIMEOUT = 60000; // 1 minute
  const PVP_APPROACH_RANGE = targets.pvpApproachRange ?? 6;
  let huntStartTime = 0;
  let huntTimeoutId: NodeJS.Timeout | null = null;
  let huntTimedOut = false;
  let targetEntity: Entity | null | undefined = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
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

  const approachTarget = new BehaviorSafeFollowEntity(bot, targets);
  approachTarget.followDistance = PVP_APPROACH_RANGE;

  pvpAttackState = new BehaviorPvpAttack(bot, targets, {
    attackRange: targets.attackRange ?? 3.0,
    followRange: targets.followRange ?? 2.0,
    viewDistance: Math.min(targets.detectionRange ?? 48, 128),
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
        handleEntityGone = (gone: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
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
    huntTimedOut = false;
    huntTimeoutId = setTimeout(() => {
      huntTimedOut = true;
      logger.info('BehaviorHuntEntity: hunt timed out after 1 minute');
      if (pvpAttackState) {
        pvpAttackState.forceStop();
      }
    }, HUNT_TIMEOUT);
  };

  const getDistanceToTarget = (): number => {
    const botPos = bot.entity?.position;
    const targetPos = targets.entity?.position;
    if (!botPos || !targetPos) return Number.POSITIVE_INFINITY;
    if (typeof targetPos.distanceTo === 'function') {
      return targetPos.distanceTo(botPos);
    }
    const dx = (targetPos.x ?? 0) - (botPos.x ?? 0);
    const dy = (targetPos.y ?? 0) - (botPos.y ?? 0);
    const dz = (targetPos.z ?? 0) - (botPos.z ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
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

  const enterToApproach = new StateTransition({
    parent: enter,
    child: approachTarget,
    name: 'BehaviorHuntEntity: enter -> approach',
    shouldTransition: () => {
      if (!targets.entity) return false;
      return true;
    },
    onTransition: () => {
      huntStartTime = Date.now();
      startHuntTimeout();
      setupEntityTracking();
      const dist = getDistanceToTarget();
      logger.info(`BehaviorHuntEntity: entity provided at ${dist.toFixed(1)} blocks, approaching to ${PVP_APPROACH_RANGE} blocks`);
    }
  });

  const findToPvpAttack = new StateTransition({
    parent: findEntity,
    child: approachTarget,
    name: 'BehaviorHuntEntity: find -> approach',
    shouldTransition: () => {
      if (targets.entity === null) return false;
      if (typeof findEntity.isFinished === 'function') {
        return findEntity.isFinished();
      }
      return true;
    },
    onTransition: () => {
      setupEntityTracking();
      logger.info(`BehaviorHuntEntity: entity found, approaching to ${PVP_APPROACH_RANGE} blocks`);
    }
  });

  const approachToPvpAttack = new StateTransition({
    parent: approachTarget,
    child: pvpAttackState,
    name: 'BehaviorHuntEntity: approach -> pvp attack',
    shouldTransition: () => {
      if (huntTimedOut) return false;
      if (!targets.entity) return false;
      const dist = getDistanceToTarget();
      if (dist <= PVP_APPROACH_RANGE) {
        return true;
      }
      if (typeof approachTarget.isFinished === 'function') {
        return approachTarget.isFinished();
      }
      return false;
    },
    onTransition: () => {
      setupEntityTracking();
      const dist = getDistanceToTarget();
      const approachMs = Date.now() - huntStartTime;
      logger.info(`BehaviorHuntEntity: within approach range (dist=${dist.toFixed(1)}), starting pvp attack after ${(approachMs / 1000).toFixed(1)}s approach`);
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

  const findToExitTimeout = new StateTransition({
    parent: findEntity,
    child: exit,
    name: 'BehaviorHuntEntity: find -> exit (timeout)',
    shouldTransition: () => huntTimedOut,
    onTransition: () => {
      clearHuntTimeout();
      cleanupEntityTracking();
      logger.info('BehaviorHuntEntity: timed out while searching, exiting');
    }
  });

  const approachToExitNoTarget = new StateTransition({
    parent: approachTarget,
    child: exit,
    name: 'BehaviorHuntEntity: approach -> exit (target lost)',
    shouldTransition: () => {
      if (!targets.entity) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
      const entityId = (targets.entity as any)?.id;
      if (entityId === undefined) return false;
      return !bot.entities || !bot.entities[entityId];
    },
    onTransition: () => {
      clearHuntTimeout();
      cleanupEntityTracking();
      logger.info('BehaviorHuntEntity: target lost while approaching, exiting');
      targets.entity = null;
    }
  });

  const approachToExitTimeout = new StateTransition({
    parent: approachTarget,
    child: exit,
    name: 'BehaviorHuntEntity: approach -> exit (timeout)',
    shouldTransition: () => huntTimedOut,
    onTransition: () => {
      clearHuntTimeout();
      cleanupEntityTracking();
      logger.info('BehaviorHuntEntity: timed out while approaching, exiting');
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
    enterToApproach,
    findToPvpAttack,
    findToExit,
    findToExitTimeout,
    approachToExitNoTarget,
    approachToExitTimeout,
    approachToPvpAttack,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project-local shim boundary
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
