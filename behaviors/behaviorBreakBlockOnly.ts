const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import { BehaviorMineBlock } from './behaviorMineBlock';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  [key: string]: any;
}

interface Bot {
  blockAt?: (pos: Vec3Like, extraInfos?: boolean) => any;
  canDigBlock?: (block: any) => boolean;
  clearControlStates?: () => void;
  [key: string]: any;
}

export interface BreakBlockTargets {
  position?: Vec3Like | null;
  blockPosition?: Vec3Like | null;
  blockName?: string | null;
  [key: string]: any;
}

export default function createBreakBlockOnlyState(bot: Bot, targets: BreakBlockTargets): any {
  const enter = new BehaviorIdle();
  const validateTarget = new BehaviorIdle();
  validateTarget.stateName = 'BreakBlockOnly:ValidateTarget';

  const mineBlock = new BehaviorMineBlock(bot, targets);
  mineBlock.stateName = 'BreakBlockOnly:MineBlock';

  addStateLogging(mineBlock, 'BreakBlockOnly:MineBlock', {
    logEnter: true,
    getExtraInfo: () => {
      const pos = targets.position;
      return pos ? `target (${pos.x}, ${pos.y}, ${pos.z})` : 'no target';
    }
  });

  const exit = new BehaviorIdle();

  let cachedBlock: any = null;
  let canDigCachedBlock = false;

  validateTarget.onStateEntered = function () {
    cachedBlock = null;
    canDigCachedBlock = false;

    const pos = targets.position;
    if (!pos) {
      return;
    }

    try {
      const block = bot.blockAt ? bot.blockAt(pos, false) : null;
      if (!block || block.type === 0) {
        logger.debug(
          `BreakBlockOnly: target block already missing at (${pos.x}, ${pos.y}, ${pos.z})`
        );
        return;
      }

      cachedBlock = block;
      canDigCachedBlock = typeof bot.canDigBlock === 'function' ? !!bot.canDigBlock(block) : true;

      if (!canDigCachedBlock) {
        logger.warn(
          `BreakBlockOnly: bot cannot dig ${block.name || 'unknown'} at (${pos.x}, ${pos.y}, ${pos.z})`
        );
      }
    } catch (err: any) {
      logger.debug(`BreakBlockOnly: error inspecting target block: ${err?.message || err}`);
      cachedBlock = null;
      canDigCachedBlock = false;
    }
  };

  const enterToValidate = new StateTransition({
    name: 'BreakBlockOnly: enter -> validate',
    parent: enter,
    child: validateTarget,
    shouldTransition: () => true
  });

  const validateToExit = new StateTransition({
    name: 'BreakBlockOnly: validate -> exit',
    parent: validateTarget,
    child: exit,
    shouldTransition: () => {
      if (!targets.position) return true;
      if (!cachedBlock) return true;
      if (!canDigCachedBlock) return true;
      return false;
    },
    onTransition: () => {
      const pos = targets.position;
      if (!pos) {
        logger.debug('BreakBlockOnly: no target position provided');
      } else if (!cachedBlock) {
        logger.debug(
          `BreakBlockOnly: target already cleared at (${pos.x}, ${pos.y}, ${pos.z})`
        );
      } else if (!canDigCachedBlock) {
        logger.warn(
          `BreakBlockOnly: skipping undiggable block ${cachedBlock.name || 'unknown'} at (${pos.x}, ${pos.y}, ${pos.z})`
        );
      }
    }
  });

  const validateToMine = new StateTransition({
    name: 'BreakBlockOnly: validate -> mine',
    parent: validateTarget,
    child: mineBlock,
    shouldTransition: () => {
      if (!targets.position) return false;
      return !!cachedBlock && canDigCachedBlock;
    },
    onTransition: () => {
      if (cachedBlock && cachedBlock.position) {
        targets.blockPosition = cachedBlock.position;
      } else if (targets.position) {
        targets.blockPosition = targets.position;
      }

      const pos = targets.blockPosition;
      const name = cachedBlock?.name || targets.blockName || 'unknown block';
      if (pos) {
        logger.info(
          `BreakBlockOnly: mining ${name} at (${pos.x}, ${pos.y}, ${pos.z})`
        );
      }
    }
  });

  const mineToExit = new StateTransition({
    name: 'BreakBlockOnly: mine -> exit',
    parent: mineBlock,
    child: exit,
    shouldTransition: () => mineBlock.isFinished === true,
    onTransition: () => {
      const pos = targets.blockPosition;
      if (pos) {
        logger.debug(
          `BreakBlockOnly: finished mining block at (${pos.x}, ${pos.y}, ${pos.z})`
        );
      }

      targets.position = undefined;
      targets.blockPosition = undefined;

      if (typeof bot.clearControlStates === 'function') {
        try {
          bot.clearControlStates();
        } catch (err: any) {
          logger.debug(
            `BreakBlockOnly: error clearing control states: ${err?.message || err}`
          );
        }
      }
    }
  });

  const transitions = [enterToValidate, validateToExit, validateToMine, mineToExit];
  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  stateMachine.stateName = 'BreakBlockOnly';

  stateMachine.onStateExited = function () {
    cachedBlock = null;
    canDigCachedBlock = false;
  };

  return stateMachine;
}


