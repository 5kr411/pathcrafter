const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import { BehaviorMineBlock } from './behaviorMineBlock';
import { findObstructingBlock } from '../utils/raycasting';
import logger from '../utils/logger';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Bot {
  entity?: { position: Vec3Like };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  world?: { getBlockType: (pos: any) => number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  blockAt?: (pos: any, extraInfos?: boolean) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  canDigBlock?: (block: any) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Targets {
  blockPosition?: Vec3Like;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface MineTargets {
  position: Vec3Like | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function createClearObstructionsState(bot: Bot, targets: Targets): any {
  const MAX_CONSECUTIVE_FAILURES = 3;
  const MAX_TOTAL_CLEARS = 10;
  let consecutiveFailures = 0;
  let totalClears = 0;

  const enter = new BehaviorIdle();
  const check = new BehaviorIdle();
  const mineTargets: MineTargets = { position: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const mineObstruction = new BehaviorMineBlock(bot, mineTargets as any);
  const exit = new BehaviorIdle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  let obstruction: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  function findObstruction(): any {
    if (!targets.blockPosition) return null;
    try {
      const targetType = bot.world?.getBlockType(targets.blockPosition);
      if (targetType === 0) return null;
    } catch (_) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    return findObstructingBlock(bot as any, { blockPosition: targets.blockPosition });
  }

  const enterToCheck = new StateTransition({
    parent: enter,
    child: check,
    name: 'ClearObstructions: enter -> check',
    shouldTransition: () => true,
    onTransition: () => {
      consecutiveFailures = 0;
      totalClears = 0;
      obstruction = findObstruction();
      logger.debug('ClearObstructions: starting obstruction check');
    }
  });

  const checkToExit = new StateTransition({
    parent: check,
    child: exit,
    name: 'ClearObstructions: check -> exit (clear)',
    shouldTransition: () => !obstruction,
    onTransition: () => {
      stateMachine.exitReason = 'clear';
      logger.info('ClearObstructions: line of sight clear');
    }
  });

  const checkToExitFailed = new StateTransition({
    parent: check,
    child: exit,
    name: 'ClearObstructions: check -> exit (failed)',
    shouldTransition: () => consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || totalClears >= MAX_TOTAL_CLEARS,
    onTransition: () => {
      stateMachine.exitReason = 'failed';
      logger.warn(`ClearObstructions: giving up after ${consecutiveFailures} consecutive failures`);
    }
  });

  const checkToMine = new StateTransition({
    parent: check,
    child: mineObstruction,
    name: 'ClearObstructions: check -> mine obstruction',
    shouldTransition: () => !!obstruction,
    onTransition: () => {
      const pos = obstruction.position;
      mineTargets.position = pos;
      logger.info(`ClearObstructions: mining obstruction ${obstruction.name || 'unknown'} at (${pos?.x}, ${pos?.y}, ${pos?.z})`);
    }
  });

  const mineToCheck = new StateTransition({
    parent: mineObstruction,
    child: check,
    name: 'ClearObstructions: mine -> check',
    shouldTransition: () => mineObstruction.isFinished,
    onTransition: () => {
      if (mineTargets.position) {
        try {
          const blockType = bot.world?.getBlockType(mineTargets.position);
          if (blockType !== undefined && blockType !== 0) {
            consecutiveFailures++;
            logger.warn(`ClearObstructions: obstruction still present after mining (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
          } else {
            consecutiveFailures = 0;
            totalClears++;
            logger.debug('ClearObstructions: obstruction cleared successfully');
          }
        } catch (_) {
          consecutiveFailures = 0;
        }
      }
      obstruction = findObstruction();
    }
  });

  const transitions = [
    enterToCheck,
    checkToExit,
    checkToExitFailed,
    checkToMine,
    mineToCheck
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  (stateMachine as any).exitReason = 'clear';

  stateMachine.onStateExited = function () {
    logger.debug('ClearObstructions: cleaning up on state exit');
    if (mineObstruction && typeof mineObstruction.onStateExited === 'function') {
      try {
        mineObstruction.onStateExited();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.warn(`ClearObstructions: error cleaning up mineObstruction: ${err.message}`);
      }
    }
    try {
      bot.clearControlStates();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`ClearObstructions: error clearing control states: ${err.message}`);
    }
  };

  return stateMachine;
}

export default createClearObstructionsState;
