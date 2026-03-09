const { parentPort, workerData, isMainThread } = require('worker_threads');

const {
  StateTransition,
  BehaviorIdle,
  BehaviorGetClosestEntity,
  NestedStateMachine,
  BehaviorFindBlock,
  BehaviorFindInteractPosition
} = require('mineflayer-statemachine');

import { BehaviorMineBlock } from './behaviorMineBlock';
import { BehaviorSmartMoveTo } from './behaviorSmartMoveTo';
import { BehaviorSafeFollowEntity } from './behaviorSafeFollowEntity';
import { BehaviorWander } from './behaviorWander';

import { getItemCountInInventory } from '../utils/inventory';
import { chooseMinimalToolName, hasEqualOrBetterTool } from '../utils/items';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getLastSnapshotRadius } from '../utils/context';
import createSafeFindBlockState from './behaviorSafeFindBlock';

import { ExecutionContext, signalToolIssue } from '../bots/collector/execution_context';
import { getDropFollowTimeoutMs } from '../bots/collector/config';
import { getHarvestToolNames, inventoryItemsToMap, isDropEntityCandidate } from './collectBlockHelpers';

const minecraftData = require('minecraft-data');

const excludedPositionType = 'excludedPosition';

function isValuableBlock(blockName: string): boolean {
  return blockName.endsWith('_ore');
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  distanceTo?: (other: Vec3Like) => number;
  [key: string]: any;
}

interface Block {
  type?: number;
  name?: string;
  harvestTools?: Record<string, any>;
  [key: string]: any;
}

interface Item {
  name?: string;
  count?: number;
  type?: number;
  [key: string]: any;
}

interface Entity {
  displayName?: string;
  position: Vec3Like;
  metadata?: any[];
  name?: string;
  objectType?: number;
  type?: string;
  [key: string]: any;
}

interface Bot {
  version?: string;
  entity?: {
    position: Vec3Like;
  };
  inventory?: {
    items?: () => Item[];
  };
  world?: {
    getBlockType: (pos: Vec3Like) => number;
  };
  blockAt?: (pos: Vec3Like, extraInfos?: boolean) => Block | null;
  entities?: Record<string, Entity>;
  [key: string]: any;
}

interface Targets {
  blockName: string;
  itemName: string;
  amount: number;
  position?: Vec3Like;
  blockPosition?: Vec3Like;
  entity?: Entity | null;
  executionContext?: ExecutionContext;
  [key: string]: any;
}

interface MinecraftData {
  blocksByName: Record<string, { id?: number; harvestTools?: Record<string, any>; material?: string }>;
  items: Array<{ id?: number; name?: string; maxDurability?: number }>;
}

function createCollectBlockState(bot: Bot, targets: Targets): any {
  const mcData: MinecraftData = minecraftData(bot.version);
  let initialId = mcData.blocksByName[targets.blockName]?.id;
  try {
    logger.debug(
      `init -> block=${targets.blockName}#${initialId}, item=${targets.itemName}, amount=${targets.amount}`
    );
  } catch (_) {}

  let currentBlockCount = 0; // Will be set by resetBaseline on first entry
  let pathfindingFailureCount = 0;
  const MAX_PATHFINDING_FAILURES = 5;
  const MINE_REACH_DISTANCE = 5;
  let missingToolInfo: { requiredTool?: string; blockName?: string; currentTool?: string } | null = null;
  let lastFailureReason: 'not_found' | 'pathfinding' | null = null;

  function collectedCount(): number {
    return getItemCountInInventory(bot, targets.itemName) - currentBlockCount;
  }

  function resetBaseline(): void {
    currentBlockCount = getItemCountInInventory(bot, targets.itemName);
    logger.debug(`resetBaseline: currentBlockCount set to ${currentBlockCount} for ${targets.itemName}`);
  }

  function checkToolRequirement(): { ok: boolean; requiredTool?: string; blockName?: string } {
    const pos = targets.blockPosition || targets.position;
    let block: Block | null | undefined = null;

    try {
      block = pos && bot.blockAt ? bot.blockAt(pos) : null;
    } catch (_) {
      block = null;
    }

    const blockName = block?.name || targets.blockName;
    const possibleTools = getHarvestToolNames(block, mcData, blockName);
    if (possibleTools.length === 0) {
      return { ok: true, blockName };
    }

    const requiredTool =
      chooseMinimalToolName(possibleTools) || possibleTools[0] || undefined;
    if (!requiredTool) {
      return { ok: true, blockName };
    }

    const inv = inventoryItemsToMap(bot.inventory?.items?.());
    const hasTool = hasEqualOrBetterTool(inv, requiredTool);

    return { ok: hasTool, requiredTool, blockName };
  }

  const enter = new BehaviorIdle();

  // Prefer safe find behavior which avoids looping over repeated positions
  let createSafeFind: any | null = null;
  let findBlock: any;
  try {
    createSafeFind = createSafeFindBlockState;
  } catch (_) {
    createSafeFind = null;
  }
  findBlock = createSafeFind ? createSafeFind(bot, targets) : new BehaviorFindBlock(bot, targets);
  if (initialId != null) findBlock.blocks = [initialId];
  try {
    const r = Number(getLastSnapshotRadius && getLastSnapshotRadius());
    if (Number.isFinite(r) && r > 0) {
      findBlock.maxDistance = r;
    } else {
      findBlock.maxDistance = 64;
    }
  } catch (_) {
    findBlock.maxDistance = 64;
  }

  // Add logging to FindBlock
  addStateLogging(findBlock, 'FindBlock', {
    logEnter: true,
    getExtraInfo: () => `searching for ${targets.blockName}${initialId ? ` (id:${initialId})` : ''}`
  });

  const findInteractPosition = new BehaviorFindInteractPosition(bot, targets);

  // Add logging to FindInteractPosition
  addStateLogging(findInteractPosition, 'FindInteractPosition', {
    logEnter: true,
    getExtraInfo: () => {
      const pos = targets.blockPosition;
      return pos ? `at (${pos.x}, ${pos.y}, ${pos.z})` : '';
    }
  });

  const goToBlock = new BehaviorSmartMoveTo(bot, targets);
  goToBlock.distance = 3;

  const MICRO_WANDER_BASE_DISTANCE = 4;
  const microWander = new BehaviorWander(bot, MICRO_WANDER_BASE_DISTANCE);
  addStateLogging(microWander, 'MicroWander', {
    logEnter: true,
    getExtraInfo: () => `repositioning ${microWander.distance} blocks (attempt ${pathfindingFailureCount}/${MAX_PATHFINDING_FAILURES})`
  });

  const mineBlock = new BehaviorMineBlock(bot, targets);

  // Add detailed logging to MineBlock with timing
  let mineStartTime: number | null = null;
  const originalMineOnStateEntered =
    typeof mineBlock.onStateEntered === 'function' ? mineBlock.onStateEntered.bind(mineBlock) : null;
  mineBlock.onStateEntered = function () {
    mineStartTime = Date.now();
    const pos = targets.position;
    try {
      const block = pos ? bot.blockAt?.(pos) : null;
      const blockName = block?.name || targets.blockName || 'unknown';
      logger.debug(`MineBlock: mining ${blockName} at (${pos?.x}, ${pos?.y}, ${pos?.z})`);
    } catch (_) {
      logger.debug(`MineBlock: mining ${targets.blockName || 'unknown block'}`);
    }
    if (originalMineOnStateEntered) return originalMineOnStateEntered();
  };

  const originalMineOnStateExited =
    typeof mineBlock.onStateExited === 'function' ? mineBlock.onStateExited.bind(mineBlock) : null;
  mineBlock.onStateExited = function () {
    if (mineStartTime) {
      const duration = Date.now() - mineStartTime;
      logger.debug(`MineBlock: finished (took ${duration}ms)`);
    }
    if (originalMineOnStateExited) return originalMineOnStateExited();
  };

  const findDrop = new BehaviorGetClosestEntity(bot, targets, (entity: Entity) => {
    const botPos = bot.entity?.position;
    const targetPos = lastBreakPosition || targets.blockPosition || targets.position || null;
    const { ok, dropInfo, distToTarget } = isDropEntityCandidate({
      entity,
      botPos,
      targetPos,
      mcData,
      dropCollectRadius: DROP_COLLECT_RADIUS,
      botRange: 12
    });

    if (ok) {
      logger.debug(
        `Found drop near mined block (${targetPos?.x},${targetPos?.y},${targetPos?.z}): metaName=${dropInfo.name}, count=${dropInfo.count}, distToMine=${distToTarget.toFixed(
          2
        )}`
      );
      return true;
    }
    return false;
  });

  // Add logging to GetClosestEntity
  addStateLogging(findDrop, 'GetClosestEntity', {
    logEnter: true,
    getExtraInfo: () => `looking for dropped ${targets.itemName}`
  });

  const goToDrop = new BehaviorSafeFollowEntity(bot, targets);

  // Add logging to FollowEntity
  addStateLogging(goToDrop, 'FollowEntity', {
    logEnter: true,
    getExtraInfo: () => {
      const entity = targets.entity;
      if (!entity?.position) return 'no entity';
      const botPos = bot.entity?.position;
      if (!botPos || !botPos.distanceTo) return `following drop at entity position`;
      const dist = botPos.distanceTo(entity.position).toFixed(2);
      return `following drop at (${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(
        1
      )}, ${entity.position.z.toFixed(1)}), distance: ${dist}m`;
    }
  });

  const exit = new BehaviorIdle();

  const enterToExitSatisfied = new StateTransition({
    parent: enter,
    child: exit,
    name: 'BehaviorCollectBlock: enter -> exit (already satisfied)',
    shouldTransition: () => {
      const collected = collectedCount();
      const done = collected >= targets.amount;
      if (done) {
        logger.info(
          `BehaviorCollectBlock: already satisfied ${collected}/${targets.amount} ${targets.itemName}, exiting`
        );
      }
      return done;
    },
    onTransition: () => {
      missingToolInfo = null;
    }
  });

  const enterToFindBlock = new StateTransition({
    parent: enter,
    child: findBlock,
    name: 'BehaviorCollectBlock: enter -> find block',
    shouldTransition: () => {
      const collected = collectedCount();
      const shouldGo = collected < targets.amount;
      logger.info(`enterToFindBlock: collected=${collected}, target=${targets.amount}, shouldTransition=${shouldGo}`);
      return shouldGo;
    },
    onTransition: () => {
      pathfindingFailureCount = 0;
      missingToolInfo = null;
      lastFailureReason = null;
      try {
        const currentId = mcData.blocksByName[targets.blockName]?.id;
        if (currentId != null) findBlock.blocks = [currentId];
        // Keep search radius in sync with snapshot radius on each entry
        try {
          const r = Number(getLastSnapshotRadius && getLastSnapshotRadius());
          if (Number.isFinite(r) && r > 0) findBlock.maxDistance = r;
        } catch (_) {}
        logger.info(`enter -> find block (target=${targets.blockName}#${currentId}, maxDistance=${findBlock.maxDistance})`);
      } catch (_) {
        logger.info('enter -> find block');
      }
    }
  });

  const findBlockToExit = new StateTransition({
    parent: findBlock,
    child: exit,
    name: 'BehaviorCollectBlock: find block -> exit',
    shouldTransition: () => {
      const isFinished = typeof findBlock.isFinished === 'function' ? findBlock.isFinished() : false;
      const noPosition = targets.position === undefined;
      logger.debug(`findBlockToExit check: isFinished=${isFinished}, targets.position=${targets.position ? 'set' : 'undefined'}, blockName=${targets.blockName}`);
      if (isFinished && noPosition) {
        logger.warn(`findBlockToExit: findBlock finished but targets.position is undefined, exiting (blockName=${targets.blockName})`);
        return true;
      }
      return false;
    },
    onTransition: () => {
      stateMachine.stepSucceeded = false;
      logger.error(`BehaviorCollectBlock: find block -> exit (could not find ${targets.blockName})`);
      lastFailureReason = 'not_found';
    }
  });

  const findBlockToFindInteractPosition = new StateTransition({
    parent: findBlock,
    child: findInteractPosition,
    name: 'BehaviorCollectBlock: find block -> find interact position',
    shouldTransition: () => {
      const hasPosition = targets.position !== undefined;
      logger.debug(`findBlockToFindInteractPosition: targets.position=${targets.position ? `(${targets.position.x},${targets.position.y},${targets.position.z})` : 'undefined'}, shouldTransition=${hasPosition}`);
      return hasPosition;
    },
    onTransition: () => {
      targets.blockPosition = targets.position;
      if (targets.position) {
        logger.info(`find block -> find interact position at (${targets.position.x}, ${targets.position.y}, ${targets.position.z})`);
      } else {
        logger.warn('find block -> find interact position but position is undefined!');
      }
    }
  });

  const findInteractPositionToGoToBlock = new StateTransition({
    parent: findInteractPosition,
    child: goToBlock,
    name: 'BehaviorCollectBlock: find interact position -> go to block',
    shouldTransition: () => {
      const requirement = checkToolRequirement();
      if (!requirement.ok) {
        if (!missingToolInfo) {
          missingToolInfo = {
            requiredTool: requirement.requiredTool,
            blockName: requirement.blockName || targets.blockName,
            currentTool: bot.heldItem?.name
          };

          const executionContext = targets.executionContext as ExecutionContext | undefined;
          if (executionContext) {
            signalToolIssue(executionContext, {
              type: 'requirement',
              toolName: missingToolInfo.requiredTool || 'unknown tool',
              blockName: missingToolInfo.blockName,
              currentToolName: missingToolInfo.currentTool
            });
          }

          logger.error(
            `BehaviorCollectBlock: missing required tool ${missingToolInfo.requiredTool || 'unknown'} for ${missingToolInfo.blockName || targets.blockName}`
          );
        }
        return false;
      }
      return true;
    },
    onTransition: () => {
      if (targets.blockPosition) {
        if (!isMainThread && parentPort) {
          parentPort.postMessage({
            from: workerData.username,
            type: excludedPositionType,
            data: targets.blockPosition
          });
          logger.debug('Added excluded position -> findBlock because self found:', targets.blockPosition);
        } else {
          logger.debug('Found block position (main thread):', targets.blockPosition);
        }
        if (findBlock && typeof findBlock.addExcludedPosition === 'function') {
          findBlock.addExcludedPosition(targets.blockPosition);
        }
        // Ensure movement has a clear goal even if interact position is unavailable
        if (!targets.position) {
          targets.position = targets.blockPosition;
        }

        goToBlock.distance = 2;

        try {
          logger.debug('moving towards position', targets.position);
        } catch (_) {}
        logger.debug('find interact position -> go to block');
      }
    }
  });

  const findInteractPositionToExitMissingTool = new StateTransition({
    parent: findInteractPosition,
    child: exit,
    name: 'BehaviorCollectBlock: missing required tool -> exit',
    shouldTransition: () => !!missingToolInfo,
    onTransition: () => {
      const info = missingToolInfo;
      const blockName = info?.blockName || targets.blockName;
      const required = info?.requiredTool || 'unknown tool';
      stateMachine.stepSucceeded = false;
      logger.error(
        `BehaviorCollectBlock: cannot collect ${blockName} - missing required tool ${required}`
      );
      missingToolInfo = null;
    }
  });

  const goToBlockToMine = new StateTransition({
    parent: goToBlock,
    child: mineBlock,
    name: 'BehaviorCollectBlock: go to block -> mine block',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();

      if (!finished) return false;
      if (distance >= MINE_REACH_DISTANCE) {
        logger.debug(`BehaviorCollectBlock: goToBlockToMine - distance ${distance.toFixed(2)} >= ${MINE_REACH_DISTANCE}, not close enough yet`);
        return false;
      }

      if (isTargetUnderFeet()) {
        logger.warn('BehaviorCollectBlock: Target is directly under bot feet, cannot mine');
        return false;
      }

      logger.info(`BehaviorCollectBlock: reached target block at distance ${distance.toFixed(2)}, proceeding to mine`);
      return true;
    },
    onTransition: () => {
      targets.position = targets.blockPosition;
      pathfindingFailureCount = 0; // Reset on successful reach
      logger.debug('go to block -> mine block');
    }
  });

  const goToBlockToFindBlockUnderFeet = new StateTransition({
    parent: goToBlock,
    child: findBlock,
    name: 'BehaviorCollectBlock: go to block -> find block (target under feet)',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();

      if (!finished) return false;
      if (distance >= MINE_REACH_DISTANCE) return false;

      return isTargetUnderFeet();
    },
    onTransition: () => {
      logger.debug('go to block -> find block (avoiding block under feet)');
    }
  });

  // Helper function to check if target is under bot's feet
  const isTargetUnderFeet = () => {
    if (!targets.blockPosition || !bot.entity || !bot.entity.position) return false;
    const botPos = bot.entity.position;
    const targetPos = targets.blockPosition;
    const botBlockX = Math.floor(botPos.x);
    const botBlockY = Math.floor(botPos.y);
    const botBlockZ = Math.floor(botPos.z);
    const targetBlockX = Math.floor(targetPos.x);
    const targetBlockY = Math.floor(targetPos.y);
    const targetBlockZ = Math.floor(targetPos.z);
    
    // Check if target is directly under bot (same X/Z, Y-1)
    return targetBlockX === botBlockX && targetBlockZ === botBlockZ && targetBlockY === botBlockY - 1;
  };

  const goToBlockToMicroWander = new StateTransition({
    parent: goToBlock,
    child: microWander,
    name: 'BehaviorCollectBlock: go to block -> micro wander (reposition)',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      return finished && distance >= MINE_REACH_DISTANCE && pathfindingFailureCount < MAX_PATHFINDING_FAILURES;
    },
    onTransition: () => {
      pathfindingFailureCount++;
      // Linear wander distance: 4, 8, 12, 16, 20, 24, 28, 32
      microWander.distance = Math.min(32, MICRO_WANDER_BASE_DISTANCE + (pathfindingFailureCount - 1) * 4);
      const distance = goToBlock.distanceToTarget();
      logger.warn(`BehaviorCollectBlock: pathfinding failed for ${targets.blockName} (${pathfindingFailureCount}/${MAX_PATHFINDING_FAILURES}), distance=${distance.toFixed(2)}, micro-wandering ${microWander.distance} blocks to reposition`);
    }
  });

  const microWanderToFindBlock = new StateTransition({
    parent: microWander,
    child: findBlock,
    name: 'BehaviorCollectBlock: micro wander -> find block',
    shouldTransition: () => microWander.isFinished,
    onTransition: () => {
      logger.info(`BehaviorCollectBlock: micro-wander complete, searching for new ${targets.blockName}`);
    }
  });

  const goToBlockToExitPathfail = new StateTransition({
    parent: goToBlock,
    child: exit,
    name: 'BehaviorCollectBlock: go to block -> exit (pathfinding give up)',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      return finished && distance >= MINE_REACH_DISTANCE && pathfindingFailureCount >= MAX_PATHFINDING_FAILURES;
    },
    onTransition: () => {
      stateMachine.stepSucceeded = false;
      logger.error(`BehaviorCollectBlock: pathfinding failed ${pathfindingFailureCount} times for ${targets.blockName}, giving up`);
      lastFailureReason = 'pathfinding';
    }
  });

  let mineBlockFinishTime: number | undefined;
  let lastBreakPosition: Vec3Like | null = null;
  let dropsCollectedThisCycle = 0;
  let targetCountBeforeFollow = 0;
  const MAX_DROPS_PER_CYCLE = 8;
  const DROP_COLLECT_RADIUS = 6;

  const mineBlockToFindDrop = new StateTransition({
    parent: mineBlock,
    child: findDrop,
    name: 'BehaviorCollectBlock: mine block -> find drop',
    shouldTransition: () => {
      if (mineBlock.isFinished && !mineBlockFinishTime) {
        mineBlockFinishTime = Date.now();
      }
      const finished = mineBlockFinishTime ? Date.now() - mineBlockFinishTime > 500 : false;
      return finished;
    },
    onTransition: () => {
      mineBlockFinishTime = undefined;
      // Save break position for collecting nearby drops
      lastBreakPosition = targets.blockPosition ? { ...targets.blockPosition } : null;
      dropsCollectedThisCycle = 0;
      try {
        const t = targets.blockPosition;
        const type = t ? bot.world?.getBlockType(t) : undefined;
        const nearbyEntities = Object.values(bot.entities || {})
          .filter((e: any) => {
            const pos = e?.position;
            const botPos = bot.entity?.position;
            if (!pos || !botPos || !pos.distanceTo) return false;
            return pos.distanceTo(botPos) < 10;
          })
          .map((e: any) => `${e.displayName || e.name || e.type} @${e.position?.x?.toFixed(0)},${e.position?.y?.toFixed(0)},${e.position?.z?.toFixed(0)}`);
        logger.debug(`mine block -> find drop (post-mine blockType=${type}). Nearby entities (${nearbyEntities.length}): ${nearbyEntities.slice(0, 5).join(', ')}`);
      } catch (_) {
        logger.debug('mine block -> find drop');
      }
    }
  });

  let goToBlockStartTime: number;
  const findDropToGoToDrop = new StateTransition({
    parent: findDrop,
    child: goToDrop,
    name: 'BehaviorCollectBlock: find drop -> go to drop',
    shouldTransition: () => targets.entity !== null,
    onTransition: () => {
      goToBlockStartTime = Date.now();
      targetCountBeforeFollow = getItemCountInInventory(bot, targets.itemName);
      try {
        const pos = targets.entity && targets.entity.position;
        const botPos = bot.entity?.position;
        const dist = pos && botPos && pos.distanceTo ? pos.distanceTo(botPos).toFixed(2) : 'n/a';
        const posStr = pos ? `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})` : 'n/a';
        logger.debug(`find drop -> go to drop at ${posStr} dist ${dist} (target count before: ${targetCountBeforeFollow})`);
      } catch (_) {
        logger.debug('find drop -> go to drop');
      }
    }
  });

  const findDropToFindBlock = new StateTransition({
    parent: findDrop,
    child: findBlock,
    name: 'BehaviorCollectBlock: find drop -> find block',
    shouldTransition: () => targets.entity === null && collectedCount() < targets.amount,
    onTransition: () => {
      try {
        const items = Object.values(bot.entities || {}).filter((e) => e.displayName === 'Item');
        logger.debug(`find drop -> find block (no more nearby drops after ${dropsCollectedThisCycle} collected). Nearby items count=${items.length}`);
      } catch (_) {
        logger.debug('find drop -> find block');
      }
      lastBreakPosition = null;
      dropsCollectedThisCycle = 0;
    }
  });

  const findDropToExit = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'BehaviorCollectBlock: find drop -> exit (satisfied)',
    shouldTransition: () => targets.entity === null && collectedCount() >= targets.amount,
    onTransition: () => {
      logger.info(`find drop -> exit: collected ${collectedCount()}/${targets.amount} ${targets.itemName} (${dropsCollectedThisCycle} drops this cycle)`);
      lastBreakPosition = null;
      dropsCollectedThisCycle = 0;
    }
  });

  // Helper to check if we reached the drop
  const reachedDrop = () => {
    const dropTimeouts = getDropFollowTimeoutMs();
    const isValuable = isValuableBlock(targets.blockName);
    const timeout = isValuable ? dropTimeouts.valuable : dropTimeouts.common;
    const timeElapsed = Date.now() - goToBlockStartTime;
    return goToDrop.distanceToTarget() <= 0.75 || timeElapsed > timeout;
  };

  // Helper to check if target item count increased after following
  const targetItemIncreased = () => {
    const currentCount = getItemCountInInventory(bot, targets.itemName);
    return currentCount > targetCountBeforeFollow;
  };

  // If target item increased, go straight to find next block (got what we needed from this break)
  const goToDropToFindBlockGotTarget = new StateTransition({
    parent: goToDrop,
    child: findBlock,
    name: 'BehaviorCollectBlock: go to drop -> find block (got target)',
    shouldTransition: () => {
      if (!reachedDrop()) return false;
      if (collectedCount() >= targets.amount) return false;
      return targetItemIncreased();
    },
    onTransition: () => {
      dropsCollectedThisCycle++;
      const currentCount = getItemCountInInventory(bot, targets.itemName);
      logger.info(`go to drop -> find block (target increased ${targetCountBeforeFollow} -> ${currentCount}, ${dropsCollectedThisCycle} drops this cycle)`);
      lastBreakPosition = null;
      dropsCollectedThisCycle = 0;
    }
  });

  // After collecting a drop that wasn't target, look for more nearby drops (up to MAX_DROPS_PER_CYCLE)
  const goToDropToFindMoreDrops = new StateTransition({
    parent: goToDrop,
    child: findDrop,
    name: 'BehaviorCollectBlock: go to drop -> find more drops',
    shouldTransition: () => {
      if (!reachedDrop()) return false;
      if (collectedCount() >= targets.amount) return false;
      if (targetItemIncreased()) return false; // Don't collect more if we got target
      
      // Check if we should collect more drops this cycle
      return dropsCollectedThisCycle < MAX_DROPS_PER_CYCLE;
    },
    onTransition: () => {
      dropsCollectedThisCycle++;
      targets.entity = null; // Clear entity so findDrop searches again
      logger.debug(`go to drop -> find more drops (${dropsCollectedThisCycle}/${MAX_DROPS_PER_CYCLE} this cycle, target didn't increase)`);
    }
  });

  const goToDropToFindBlock = new StateTransition({
    parent: goToDrop,
    child: findBlock,
    name: 'BehaviorCollectBlock: go to drop -> find block',
    shouldTransition: () => {
      if (!reachedDrop()) return false;
      if (collectedCount() >= targets.amount) return false;
      if (targetItemIncreased()) return false; // Handled by goToDropToFindBlockGotTarget
      
      // Only go to find block if we've collected enough drops this cycle
      return dropsCollectedThisCycle >= MAX_DROPS_PER_CYCLE;
    },
    onTransition: () => {
      logger.info(`go to drop -> find block (collected ${dropsCollectedThisCycle} drops this cycle, target didn't drop)`);
      logger.info(`Blocks collected: ${collectedCount()}/${targets.amount} ${targets.itemName}`);
      lastBreakPosition = null;
      dropsCollectedThisCycle = 0;
    }
  });

  const goToDropToExit = new StateTransition({
    parent: goToDrop,
    child: exit,
    name: 'BehaviorCollectBlock: go to drop -> exit',
    shouldTransition: () => {
      const timeElapsed = Date.now() - goToBlockStartTime;
      return (goToDrop.distanceToTarget() <= 0.75 && timeElapsed > 1000) ||
        (collectedCount() >= targets.amount && timeElapsed > 1000);
    },
    onTransition: () => {
      logger.info(
        `go to drop -> exit: ${collectedCount()}/${targets.amount} ${
          targets.itemName
        } collected, ${getItemCountInInventory(bot, targets.itemName)} total`
      );
    }
  });

  const transitions = [
    enterToExitSatisfied,
    enterToFindBlock,
    findBlockToExit,
    findBlockToFindInteractPosition,
    findInteractPositionToGoToBlock,
    findInteractPositionToExitMissingTool,
    goToBlockToMine,
    goToBlockToFindBlockUnderFeet,
    goToBlockToMicroWander,
    microWanderToFindBlock,
    goToBlockToExitPathfail,
    mineBlockToFindDrop,
    findDropToGoToDrop,
    findDropToExit,
    findDropToFindBlock,
    goToDropToFindBlockGotTarget,
    goToDropToFindMoreDrops,
    goToDropToFindBlock,
    goToDropToExit
  ];

  // Reset baseline on every re-entry via the enter state's lifecycle hook.
  // This ensures currentBlockCount is set BEFORE any shouldTransition polls,
  // which is critical when MineOneOf/MineAnyOf reuse the same CollectBlock instance.
  enter.onStateEntered = () => {
    resetBaseline();
    pathfindingFailureCount = 0;
  };

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  (stateMachine as any).resetBaseline = resetBaseline;
  (stateMachine as any).collectedCount = collectedCount;
  (stateMachine as any).getLastFailureReason = () => lastFailureReason;
  (stateMachine as any).clearBlockExclusions = () => {
    if (findBlock && typeof findBlock.clearExclusions === 'function') {
      findBlock.clearExclusions();
    }
  };

  // Store the framework's original onStateExited so we can call it after cleanup
  const frameworkOnStateExited = stateMachine.onStateExited.bind(stateMachine);

  stateMachine.onStateExited = function() {
    logger.debug('CollectBlock: cleaning up on state exit');
    missingToolInfo = null;
    // NOTE: Do NOT clear lastFailureReason here - MineAnyOf needs to read it
    // in its onTransition. It gets reset in enterToFindBlock.onTransition instead.

    if (goToBlock && typeof goToBlock.onStateExited === 'function') {
      try {
        goToBlock.onStateExited();
        logger.debug('CollectBlock: cleaned up goToBlock');
      } catch (err: any) {
        logger.warn(`CollectBlock: error cleaning up goToBlock: ${err.message}`);
      }
    }

    if (mineBlock && typeof mineBlock.onStateExited === 'function') {
      try {
        mineBlock.onStateExited();
        logger.debug('CollectBlock: cleaned up mineBlock');
      } catch (err: any) {
        logger.warn(`CollectBlock: error cleaning up mineBlock: ${err.message}`);
      }
    }

    if (microWander && typeof microWander.onStateExited === 'function') {
      try {
        microWander.onStateExited();
        logger.debug('CollectBlock: cleaned up microWander');
      } catch (err: any) {
        logger.warn(`CollectBlock: error cleaning up microWander: ${err.message}`);
      }
    }

    if (goToDrop && typeof goToDrop.onStateExited === 'function') {
      try {
        goToDrop.onStateExited();
        logger.debug('CollectBlock: cleaned up goToDrop');
      } catch (err: any) {
        logger.warn(`CollectBlock: error cleaning up goToDrop: ${err.message}`);
      }
    }

    try {
      bot.clearControlStates();
      logger.debug('CollectBlock: cleared bot control states');
    } catch (err: any) {
      logger.debug(`CollectBlock: error clearing control states: ${err.message}`);
    }

    // Call framework's onStateExited to properly deactivate internal states
    // and reset activeState. Without this, re-entry doesn't work correctly.
    frameworkOnStateExited();
  };
  
  return stateMachine;
}

export default createCollectBlockState;
