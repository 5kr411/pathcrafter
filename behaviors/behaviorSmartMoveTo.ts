const { StateTransition, NestedStateMachine, BehaviorIdle } = require('mineflayer-statemachine');
import createBaritoneMoveToState from './behaviorBaritoneMoveTo';
import createMineflayerMoveToState from './behaviorMineflayerMoveTo';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';

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
      
      // Check if mineflayer failed (stuck or didn't reach goal)
      const didFail = typeof mineflayerMove.didFail === 'function' ? mineflayerMove.didFail() : false;
      const distanceToTarget = mineflayerMove.distanceToTarget();
      const reachedGoal = distanceToTarget < (mineflayerMove.distance || 1);
      
      // Don't fallback if we succeeded
      if (reachedGoal && !didFail) {
        return false;
      }
      
      const distance = getDistance();
      if (distance < 10) {
        logger.debug(`SmartMoveTo: skipping baritone fallback for short distance (${distance.toFixed(2)}m < 10m)`);
        return false;
      }
      
      return true;
    },
    onTransition: () => {
      const distance = getDistance();
      const didFail = typeof mineflayerMove.didFail === 'function' ? mineflayerMove.didFail() : false;
      if (didFail) {
        logger.info(`SmartMoveTo: mineflayer got stuck, trying baritone fallback (distance: ${distance.toFixed(2)}m)`);
      } else {
        logger.info(`SmartMoveTo: mineflayer failed to reach goal, trying baritone fallback (distance: ${distance.toFixed(2)}m)`);
      }
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
      
      // Don't exit if baritone fallback is available
      if (useBaritoneAsFallback && hasBaritone && getDistance() >= 10) {
        return false;
      }
      
      return true;
    },
    onTransition: () => {
      const didFail = typeof mineflayerMove.didFail === 'function' ? mineflayerMove.didFail() : false;
      if (didFail) {
        logger.warn('SmartMoveTo: mineflayer got stuck and no baritone fallback available');
      } else {
        logger.warn('SmartMoveTo: mineflayer failed and no baritone fallback available');
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

