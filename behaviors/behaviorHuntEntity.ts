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
  pvpApproachRange?: number;
  [key: string]: any;
}

const FAILED_TARGET_COOLDOWN = 10000; // 10 seconds before retrying a failed target
const failedTargets = new Map<number, number>(); // entityId -> failedTime

function resolveEntityId(entityOrId: Entity | number | null | undefined): number | null {
  if (typeof entityOrId === 'number') {
    return entityOrId;
  }
  const entityId = (entityOrId as any)?.id;
  if (typeof entityId !== 'number') return null;
  return entityId;
}

function getFailedTargetCooldownRemainingMs(entityOrId: Entity | number | null | undefined): number {
  const entityId = resolveEntityId(entityOrId);
  if (entityId === null) return 0;
  const failedTime = failedTargets.get(entityId);
  if (failedTime === undefined) return 0;
  const remaining = FAILED_TARGET_COOLDOWN - (Date.now() - failedTime);
  if (remaining <= 0) {
    failedTargets.delete(entityId);
    return 0;
  }
  return remaining;
}

export function getFailedTargetCooldownRemaining(entityOrId: Entity | number | null | undefined): number {
  return getFailedTargetCooldownRemainingMs(entityOrId);
}

function isRecentlyFailedTarget(entity: Entity | null | undefined): boolean {
  return getFailedTargetCooldownRemainingMs(entity) > 0;
}

function markTargetAsFailed(entity: Entity | null | undefined): void {
  if (!entity) return;
  const entityId = (entity as any)?.id;
  if (entityId === undefined || entityId === null) return;
  failedTargets.set(entityId, Date.now());
  logger.warn(`BehaviorHuntEntity: marking entity ${entityId} as unreachable for ${FAILED_TARGET_COOLDOWN / 1000}s`);
}

/**
 * Hunt entity behavior - uses mineflayer-pvp for combat
 * Attacks continuously until entity is dead, despawned, or timeout
 */
function createHuntEntityState(bot: Bot, targets: Targets): any {
  const HUNT_TIMEOUT = 60000; // 1 minute
  const PVP_APPROACH_RANGE = targets.pvpApproachRange ?? 16;
  let huntStartTime = 0;
  let huntTimeoutId: NodeJS.Timeout | null = null;
  let huntTimedOut = false;
  let targetEntity: Entity | null | undefined = null;
  let handleEntityGone: ((entity: any) => void) | null = null;
  let pvpAttackState: BehaviorPvpAttack | null = null;
  let attackSucceeded = false;

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
    viewDistance: targets.detectionRange ?? 48,
    onAttackPerformed: () => {
      attackSucceeded = true;
    },
    onStopped: (reason) => {
      logger.info(`BehaviorHuntEntity: pvp stopped - reason: ${reason}`);
      if (reason === 'target_lost' && !attackSucceeded && targetEntity) {
        markTargetAsFailed(targetEntity);
      }
    }
  });

  const exit = new BehaviorIdle();

  const setupEntityTracking = () => {
    if (targets.entity && !targetEntity) {
      targetEntity = targets.entity;
      attackSucceeded = false;
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
      if (isRecentlyFailedTarget(targets.entity)) {
        logger.debug(`BehaviorHuntEntity: skipping recently failed target ${(targets.entity as any)?.id}`);
        return false;
      }
      return true;
    },
    onTransition: () => {
      huntStartTime = Date.now();
      startHuntTimeout();
      setupEntityTracking();
      logger.info(`BehaviorHuntEntity: entity provided, approaching to ${PVP_APPROACH_RANGE} blocks`);
    }
  });

  const findToPvpAttack = new StateTransition({
    parent: findEntity,
    child: approachTarget,
    name: 'BehaviorHuntEntity: find -> approach',
    shouldTransition: () => {
      if (targets.entity === null) return false;
      if (isRecentlyFailedTarget(targets.entity)) {
        logger.debug(`BehaviorHuntEntity: skipping recently failed target ${(targets.entity as any)?.id}`);
        return false;
      }
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
      if (isRecentlyFailedTarget(targets.entity)) {
        logger.debug(`BehaviorHuntEntity: skipping recently failed target ${(targets.entity as any)?.id}`);
        return false;
      }
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
      logger.info('BehaviorHuntEntity: within approach range, starting pvp attack');
    }
  });

  const enterToExitFailedTarget = new StateTransition({
    parent: enter,
    child: exit,
    name: 'BehaviorHuntEntity: enter -> exit (recently failed target)',
    shouldTransition: () => {
      if (!targets.entity) return false;
      return isRecentlyFailedTarget(targets.entity);
    },
    onTransition: () => {
      const entityId = (targets.entity as any)?.id;
      const cooldownRemaining = getFailedTargetCooldownRemaining(targets.entity);
      logger.info(`BehaviorHuntEntity: skipping unreachable target ${entityId}, cooldown ${(cooldownRemaining / 1000).toFixed(1)}s remaining`);
      targets.entity = null;
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
      if (targetEntity) {
        markTargetAsFailed(targetEntity);
      }
      logger.info('BehaviorHuntEntity: timed out while approaching, exiting');
    }
  });

  const findToExitFailedTarget = new StateTransition({
    parent: findEntity,
    child: exit,
    name: 'BehaviorHuntEntity: find -> exit (recently failed target)',
    shouldTransition: () => {
      if (!targets.entity) return false;
      return isRecentlyFailedTarget(targets.entity);
    },
    onTransition: () => {
      clearHuntTimeout();
      cleanupEntityTracking();
      const entityId = (targets.entity as any)?.id;
      logger.info(`BehaviorHuntEntity: found entity ${entityId} but it was recently unreachable, skipping`);
      targets.entity = null;
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
    enterToExitFailedTarget,
    enterToFind,
    enterToApproach,
    findToExitFailedTarget,
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
