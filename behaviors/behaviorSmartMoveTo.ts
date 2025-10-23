const { StateTransition, NestedStateMachine, BehaviorIdle } = require('mineflayer-statemachine');
import createBaritoneMoveToState from './behaviorBaritoneMoveTo';
import createMineflayerMoveToState from './behaviorMineflayerMoveTo';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { forceStopAllMovement } from '../utils/movement';

interface Bot {
  entity?: any;
  ashfinder?: any;
  [key: string]: any;
}

interface Targets {
  position?: any;
  goal?: any;
  preferBaritone?: boolean;
  baritoneTimeout?: number;
  [key: string]: any;
}

function createSmartMoveToState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const baritoneMove = createBaritoneMoveToState(bot, targets);
  const mineflayerMove = createMineflayerMoveToState(bot, targets);
  const exit = new BehaviorIdle();

  addStateLogging(mineflayerMove, 'MineflayerMoveTo', {
    logEnter: true,
    getExtraInfo: () => {
      const pos = targets.position;
      if (!pos) return 'no position';
      const botPos = bot.entity?.position;
      if (!botPos || !botPos.distanceTo) return `to (${pos.x}, ${pos.y}, ${pos.z})`;
      const dist = botPos.distanceTo(pos).toFixed(2);
      return `to (${pos.x}, ${pos.y}, ${pos.z}), distance: ${dist}m`;
    }
  });

  addStateLogging(baritoneMove, 'BaritoneMoveTo (fallback)', {
    logEnter: true,
    getExtraInfo: () => {
      const pos = targets.position;
      if (!pos) return 'no position';
      const botPos = bot.entity?.position;
      if (!botPos || !botPos.distanceTo) return `to (${pos.x}, ${pos.y}, ${pos.z})`;
      const dist = botPos.distanceTo(pos).toFixed(2);
      return `to (${pos.x}, ${pos.y}, ${pos.z}), distance: ${dist}m`;
    }
  });

  const useBaritoneAsFallback = targets.useBaritoneAsFallback !== false;
  const hasBaritone = !!bot.ashfinder;
  // Require mineflayer to be active for at least this long before treating it as failed
  const minMineflayerActiveMs = typeof targets.minMineflayerActiveMs === 'number' ? targets.minMineflayerActiveMs : 3000;
  // Distance threshold at which we allow switching to baritone fallback
  const baritoneFallbackMinDistance = typeof targets.baritoneFallbackMinDistance === 'number' ? targets.baritoneFallbackMinDistance : 6;
  let mineflayerStartTime: number | null = null;
  // Progress gating: as long as bot is moving significantly, don't fall back
  const progressWindowMs = typeof targets.progressWindowMs === 'number' ? targets.progressWindowMs : 10000;
  const minProgressDelta = typeof targets.minProgressDelta === 'number' ? targets.minProgressDelta : 2;
  let lastProgressCheckTime: number | null = null;
  let lastProgressPosition: any = null;
  // Cross-behavior mutual exclusion lock persisted on bot
  const switchCooldownMs = typeof (targets as any).switchCooldownMs === 'number' ? (targets as any).switchCooldownMs : 1500;
  const getActiveMover = (): 'mineflayer' | 'baritone' | null => bot.__activeMover || null;
  const setActiveMover = (m: 'mineflayer' | 'baritone' | null) => {
    bot.__activeMover = m;
    bot.__lastMoveSwitch = Date.now();
  };
  const timeSinceLastSwitch = (): number => {
    const t = bot.__lastMoveSwitch || 0;
    return Date.now() - t;
  };

  const recordProgressSnapshot = () => {
    lastProgressCheckTime = Date.now();
    if (bot.entity?.position) {
      const p = bot.entity.position;
      lastProgressPosition = { x: p.x, y: p.y, z: p.z };
    } else {
      lastProgressPosition = null;
    }
  };

  const hasSignificantProgress = (): boolean => {
    if (!lastProgressCheckTime || !lastProgressPosition || !bot.entity?.position) return false;
    const now = Date.now();
    if (now - lastProgressCheckTime < progressWindowMs) return false;
    const p = bot.entity.position;
    const dx = p.x - lastProgressPosition.x;
    const dy = p.y - lastProgressPosition.y;
    const dz = p.z - lastProgressPosition.z;
    const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Only refresh snapshot when we actually evaluate the full window
    recordProgressSnapshot();
    return moved >= minProgressDelta;
  };

  const getProgressInfo = (): { moved: number; elapsedMs: number } => {
    if (!lastProgressCheckTime || !lastProgressPosition || !bot.entity?.position) return { moved: 0, elapsedMs: 0 };
    const now = Date.now();
    const p = bot.entity.position;
    const dx = p.x - lastProgressPosition.x;
    const dy = p.y - lastProgressPosition.y;
    const dz = p.z - lastProgressPosition.z;
    const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return { moved, elapsedMs: now - lastProgressCheckTime };
  };
  
  const getDistance = (): number => {
    if (!targets.position || !bot.entity?.position) return Infinity;
    const dx = bot.entity.position.x - targets.position.x;
    const dy = bot.entity.position.y - targets.position.y;
    const dz = bot.entity.position.z - targets.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  const enterToMineflayer = new StateTransition({
    name: 'SmartMoveTo: enter -> mineflayer',
    parent: enter,
    child: mineflayerMove,
    shouldTransition: () => true,
    onTransition: () => {
      try { forceStopAllMovement(bot, 'entering mineflayer'); } catch {}
      mineflayerStartTime = Date.now();
      recordProgressSnapshot();
      setActiveMover('mineflayer');
      logger.info('SmartMoveTo: attempting mineflayer pathfinding');
    }
  });

  const mineflayerToExit = new StateTransition({
    name: 'SmartMoveTo: mineflayer -> exit (success)',
    parent: mineflayerMove,
    child: exit,
    shouldTransition: () => mineflayerMove.isFinished() && mineflayerMove.distanceToTarget() < (mineflayerMove.distance || 1),
    onTransition: () => {
      logger.info('SmartMoveTo: mineflayer succeeded');
    }
  });

  const mineflayerToBaritone = new StateTransition({
    name: 'SmartMoveTo: mineflayer -> baritone (fallback)',
    parent: mineflayerMove,
    child: baritoneMove,
    shouldTransition: () => {
      if (!mineflayerMove.isFinished()) return false;
      if (!useBaritoneAsFallback || !hasBaritone) return false;
      
      // Check if mineflayer failed (stuck) or simply finished without reaching goal (no path)
      const didFail = typeof mineflayerMove.didFail === 'function' ? mineflayerMove.didFail() : false;
      const distanceToTarget = mineflayerMove.distanceToTarget();
      const reachedGoal = distanceToTarget < (mineflayerMove.distance || 1);
      
      // If mineflayer finished but did not reach goal (e.g., no path), allow baritone to take over (with cooldown and distance checks)
      if (!didFail && !reachedGoal) {
        if (getActiveMover() === 'baritone') return false;
        if (timeSinceLastSwitch() < switchCooldownMs) return false;
        const distance = getDistance();
        if (distance < baritoneFallbackMinDistance) return false;
        return true;
      }
      // Otherwise, only allow baritone fallback when mineflayer explicitly reports stuck
      if (!didFail) return false;
      // Enforce mutual exclusion and cooldown to avoid thrash
      if (getActiveMover() === 'baritone') return false;
      if (timeSinceLastSwitch() < switchCooldownMs) return false;
      // Guard: don't mark as failed immediately; ensure minimum active time elapsed
      if (mineflayerStartTime && (Date.now() - mineflayerStartTime) < minMineflayerActiveMs) {
        return false;
      }
      // New guard: if we've made significant progress recently, keep using mineflayer
      if (hasSignificantProgress()) {
        const pi = getProgressInfo();
        logger.debug(`SmartMoveTo: continuing mineflayer (recent progress detected: moved ${pi.moved.toFixed(2)}m / ${(pi.elapsedMs/1000).toFixed(1)}s)`);
        return false;
      }
      
      const distance = getDistance();
      if (distance < baritoneFallbackMinDistance) {
        logger.debug(`SmartMoveTo: skipping baritone fallback for short distance (${distance.toFixed(2)}m < ${baritoneFallbackMinDistance}m)`);
        return false;
      }
      
      return true;
    },
    onTransition: () => {
      const distance = getDistance();
      setActiveMover('baritone');
      try { forceStopAllMovement(bot, 'switching to baritone'); } catch {}
      const pi = getProgressInfo();
      logger.info(`SmartMoveTo: mineflayer stuck, using baritone fallback (distance: ${distance.toFixed(2)}m, progress ${pi.moved.toFixed(2)}m / ${(pi.elapsedMs/1000).toFixed(1)}s)`);
    }
  });

  const mineflayerToExitFailed = new StateTransition({
    name: 'SmartMoveTo: mineflayer -> exit (no fallback)',
    parent: mineflayerMove,
    child: exit,
    shouldTransition: () => {
      if (!mineflayerMove.isFinished()) return false;
      
      const didFail = typeof mineflayerMove.didFail === 'function' ? mineflayerMove.didFail() : false;
      const distanceToTarget = mineflayerMove.distanceToTarget();
      const reachedGoal = distanceToTarget < (mineflayerMove.distance || 1);
      
      // Exit if we succeeded
      if (reachedGoal && !didFail) {
        return false;
      }
      // If not stuck, do not exit; allow mineflayer to continue attempts
      if (!didFail) {
        // If we're making progress, keep going; otherwise, allow re-evaluation next tick
        if (hasSignificantProgress()) {
          const pi = getProgressInfo();
          logger.debug(`SmartMoveTo: mineflayer not stuck and making progress; not exiting (progress ${pi.moved.toFixed(2)}m / ${(pi.elapsedMs/1000).toFixed(1)}s)`);
          return false;
        }
        return false;
      }
      // If stuck but baritone fallback disabled/unavailable, exit
      if (!useBaritoneAsFallback || !hasBaritone) {
        return true;
      }
      // If stuck and fallback available, let the other transition handle it
      return false;
    },
    onTransition: () => {
      const didFail = typeof mineflayerMove.didFail === 'function' ? mineflayerMove.didFail() : false;
      if (didFail && (!useBaritoneAsFallback || !hasBaritone)) {
        logger.warn('SmartMoveTo: mineflayer stuck and no baritone fallback available');
      } else if (!didFail) {
        logger.warn('SmartMoveTo: mineflayer finished without success; not using baritone fallback');
      }
    }
  });

  const baritoneToExit = new StateTransition({
    name: 'SmartMoveTo: baritone -> exit',
    parent: baritoneMove,
    child: exit,
    shouldTransition: () => baritoneMove.isFinished(),
    onTransition: () => {
      if (baritoneMove.didSucceed()) {
        logger.info('SmartMoveTo: baritone fallback succeeded');
      } else {
        logger.error('SmartMoveTo: both mineflayer and baritone failed');
      }
      setActiveMover(null);
    }
  });

  const transitions = [
    enterToMineflayer,
    mineflayerToExit,
    mineflayerToBaritone,
    mineflayerToExitFailed,
    baritoneToExit
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  stateMachine.stateName = 'BehaviorSmartMoveTo';

  stateMachine.distanceToTarget = function() {
    if (baritoneMove.active && baritoneMove.distanceToTarget) {
      return baritoneMove.distanceToTarget();
    }
    if (mineflayerMove.active && mineflayerMove.distanceToTarget) {
      return mineflayerMove.distanceToTarget();
    }
    
    if (!targets.position || !bot.entity?.position) {
      return Infinity;
    }
    
    const botPos = bot.entity.position;
    const targetPos = targets.position;
    const dx = botPos.x - targetPos.x;
    const dy = botPos.y - targetPos.y;
    const dz = botPos.z - targetPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  stateMachine.onStateExited = function() {
    logger.debug('SmartMoveTo: cleaning up on state exit');
    setActiveMover(null);
    try { forceStopAllMovement(bot, 'smart move state exit'); } catch {}
    
    if (baritoneMove && typeof baritoneMove.onStateExited === 'function') {
      try {
        baritoneMove.onStateExited();
      } catch (err: any) {
        logger.warn(`SmartMoveTo: error cleaning up baritone: ${err.message}`);
      }
    }
    
    if (mineflayerMove && typeof mineflayerMove.onStateExited === 'function') {
      try {
        mineflayerMove.onStateExited();
      } catch (err: any) {
        logger.warn(`SmartMoveTo: error cleaning up mineflayer: ${err.message}`);
      }
    }
    
    if (bot.ashfinder) {
      try {
        bot.ashfinder.stop();
        logger.debug('SmartMoveTo: stopped baritone pathfinding');
      } catch (err: any) {
        logger.debug(`SmartMoveTo: error stopping baritone: ${err.message}`);
      }
    }
    
    try {
      bot.clearControlStates();
      logger.debug('SmartMoveTo: cleared bot control states');
    } catch (err: any) {
      logger.debug(`SmartMoveTo: error clearing control states: ${err.message}`);
    }
  };

  return stateMachine;
}

export default createSmartMoveToState;

