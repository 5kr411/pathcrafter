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
      
      const distance = getDistance();
      if (distance < 10) {
        logger.debug(`SmartMoveTo: skipping baritone fallback for short distance (${distance.toFixed(2)}m < 10m)`);
        return false;
      }
      
      return true;
    },
    onTransition: () => {
      const distance = getDistance();
      logger.info(`SmartMoveTo: mineflayer failed, trying baritone fallback (distance: ${distance.toFixed(2)}m)`);
    }
  });

  const mineflayerToExitFailed = new StateTransition({
    name: 'SmartMoveTo: mineflayer -> exit (no fallback)',
    parent: mineflayerMove,
    child: exit,
    shouldTransition: () => {
      if (!mineflayerMove.isFinished()) return false;
      if (useBaritoneAsFallback && hasBaritone && getDistance() >= 10) return false;
      return true;
    },
    onTransition: () => {
      logger.warn('SmartMoveTo: mineflayer failed and no baritone fallback available');
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

  return stateMachine;
}

export default createSmartMoveToState;

