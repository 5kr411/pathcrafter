const { parentPort, workerData, isMainThread } = require('worker_threads');

const {
  StateTransition,
  BehaviorIdle,
  BehaviorFollowEntity,
  BehaviorGetClosestEntity,
  NestedStateMachine,
  BehaviorFindBlock,
  BehaviorFindInteractPosition
} = require('mineflayer-statemachine');

import { BehaviorMineBlock } from './behaviorMineBlock';
import { BehaviorSmartMoveTo } from './behaviorSmartMoveTo';
import createBreakBlockOnlyState, { BreakBlockTargets } from './behaviorBreakBlockOnly';

import { getItemCountInInventory } from '../utils/inventory';
import { chooseMinimalToolName, hasEqualOrBetterTool } from '../utils/items';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getLastSnapshotRadius } from '../utils/context';
import createSafeFindBlockState from './behaviorSafeFindBlock';
import { canSeeTargetBlock, findObstructingBlock } from '../utils/raycasting';
import { ExecutionContext, signalToolIssue } from '../bots/collector/execution_context';
import { getDropFollowTimeoutMs } from '../bots/collector/config';

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
  let pathfindingFailureCount = 0; // Track how many times pathfinding failed and we searched for closer block
  const MAX_PATHFINDING_FAILURES = 20; // Max attempts before giving up
  let missingToolInfo: { requiredTool?: string; blockName?: string; currentTool?: string } | null = null;
  let pathfindingGiveUpLogged = false;
  let lastEnterLogCollected: number | null = null;
  let lastEnterLogTime = 0;
  let lastFindFailTime: number | null = null;
  const lastFindFailLogTimeByBlock = new Map<string, number>();
  let lastFailureReason: 'not_found' | 'pathfinding' | null = null;
  let lastDropMetadataLogTime: number | null = null;

  function collectedCount(): number {
    return getItemCountInInventory(bot, targets.itemName) - currentBlockCount;
  }

  function resetBaseline(): void {
    currentBlockCount = getItemCountInInventory(bot, targets.itemName);
    logger.debug(`resetBaseline: currentBlockCount set to ${currentBlockCount} for ${targets.itemName}`);
  }

  function inventoryAsMap(): Map<string, number> {
    const out = new Map<string, number>();
    try {
      const items = bot.inventory?.items?.() || [];
      for (const item of items) {
        if (!item || !item.name) continue;
        const count = Number.isFinite(item.count) ? item.count! : 1;
        if (!count || count <= 0) continue;
        out.set(item.name, (out.get(item.name) || 0) + count);
      }
    } catch (_) {}
    return out;
  }

  function getHarvestToolNames(block: Block | null | undefined, fallbackName?: string): string[] {
    const harvestTools =
      block?.harvestTools ||
      (fallbackName ? mcData.blocksByName[fallbackName]?.harvestTools : undefined);
    if (!harvestTools) return [];

    return Object.keys(harvestTools)
      .map((id) => {
        const toolId = Number(id);
        return mcData.items[toolId]?.name;
      })
      .filter((n): n is string => !!n);
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
    const possibleTools = getHarvestToolNames(block, blockName);
    if (possibleTools.length === 0) {
      return { ok: true, blockName };
    }

    const requiredTool =
      chooseMinimalToolName(possibleTools) || possibleTools[0] || undefined;
    if (!requiredTool) {
      return { ok: true, blockName };
    }

    const inv = inventoryAsMap();
    const hasTool = hasEqualOrBetterTool(inv, requiredTool);

    return { ok: hasTool, requiredTool, blockName };
  }

  const enter = new BehaviorIdle();

  function getDroppedItemInfo(entity: Entity): { name: string | null; count: number } {
    // Mineflayer encodes dropped item stack in metadata index 7 for item entities
    try {
      const meta = Array.isArray(entity?.metadata) ? entity.metadata[7] : null;
      if (meta && meta.itemId !== undefined) {
        const itemId = meta.itemId;
        const itemName = mcData.items?.[itemId]?.name || null;
        const count = Number(meta.itemCount || meta.count || 1) || 1;
        return { name: itemName, count };
      }
    } catch (_) {}
    return { name: null, count: 0 };
  }

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

  const mineBlock = new BehaviorMineBlock(bot, targets);

  // Add detailed logging to MineBlock with timing
  let mineStartTime: number | null = null;
  const originalMineOnStateEntered =
    typeof mineBlock.onStateEntered === 'function' ? mineBlock.onStateEntered.bind(mineBlock) : null;
  mineBlock.onStateEntered = function () {
    mineStartTime = Date.now();
    lastDropMetadataLogTime = null;
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
    if (!botPos || !entity.position?.distanceTo) return false;
    const isItem =
      entity.displayName === 'Item' ||
      entity.name === 'item' ||
      entity.type === 'object' ||
      Array.isArray(entity.metadata);
    if (!isItem) return false;

    const targetPos = targets.blockPosition || targets.position;
    const distToMine =
      targetPos && targetPos.distanceTo ? targetPos.distanceTo(entity.position) : Number.POSITIVE_INFINITY;

    // Collect any item within 3 blocks of the mined block
    const nearMinedPos = distToMine < 3;
    const inBotRange = entity.position.distanceTo(botPos) < 12;

    if (nearMinedPos && inBotRange) {
      const dropInfo = getDroppedItemInfo(entity);
      logger.debug(
        `Found drop near mined block (${targetPos?.x},${targetPos?.y},${targetPos?.z}): metaName=${dropInfo.name}, count=${dropInfo.count}, distToMine=${distToMine.toFixed(
          2
        )}`
      );
      return true;
    }
    return false;
  });

  function logNearbyItemMetadata(context: string): void {
    const now = Date.now();
    const targetPos = targets.blockPosition || targets.position || bot.entity?.position;
    if (!targetPos) return;
    if (lastDropMetadataLogTime && now - lastDropMetadataLogTime < 1000) return;
    lastDropMetadataLogTime = now;
    try {
      const items = Object.values(bot.entities || {}).filter((e: any) => {
        return e && (e.displayName === 'Item' || e.name === 'item' || e.type === 'object') && e.position?.distanceTo;
      });
      const desc = items.map((e: any) => {
        const dist = targetPos && e.position?.distanceTo ? e.position.distanceTo(targetPos).toFixed(2) : 'n/a';
        const meta = Array.isArray(e.metadata) ? e.metadata[7] : undefined;
        return `@${e.position?.x?.toFixed(1)},${e.position?.y?.toFixed(1)},${e.position?.z?.toFixed(1)} d=${dist} meta=${JSON.stringify(meta)}`;
      });
      logger.debug(`DropDebug[${context}]: nearby items for ${targets.itemName}: ${desc.join(' | ') || 'none'}`);
    } catch (err: any) {
      logger.debug(`DropDebug[${context}]: error logging item metadata: ${err?.message || err}`);
    }
  }

  // Add logging to GetClosestEntity
  addStateLogging(findDrop, 'GetClosestEntity', {
    logEnter: true,
    getExtraInfo: () => `looking for dropped ${targets.itemName}`
  });

  const goToDrop = new BehaviorFollowEntity(bot, targets);

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

  let baselineInitialized = false;

  const enterToExitSatisfied = new StateTransition({
    parent: enter,
    child: exit,
    name: 'BehaviorCollectBlock: enter -> exit (already satisfied)',
    shouldTransition: () => {
      if (!baselineInitialized && targets.itemName) {
        resetBaseline();
        baselineInitialized = true;
      }
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
      pathfindingFailureCount = 0;
      pathfindingGiveUpLogged = false;
      missingToolInfo = null;
    }
  });

  const enterToFindBlock = new StateTransition({
    parent: enter,
    child: findBlock,
    name: 'BehaviorCollectBlock: enter -> find block',
    shouldTransition: () => {
      if (!baselineInitialized && targets.itemName) {
        resetBaseline();
        baselineInitialized = true;
      }
      if (lastFindFailTime && Date.now() - lastFindFailTime < 2000) {
        logger.debug('enterToFindBlock: cooling down after recent find failure');
        return false;
      }
      const collected = collectedCount();
      const shouldGo = collected < targets.amount;
      if (shouldGo) {
        logger.info(`enterToFindBlock: collected=${collected}, target=${targets.amount}, shouldTransition=${shouldGo}`);
      } else {
        const now = Date.now();
        if (lastEnterLogCollected !== collected || now - lastEnterLogTime > 5000) {
          logger.info(`enterToFindBlock: collected=${collected}, target=${targets.amount}, shouldTransition=${shouldGo}`);
          lastEnterLogCollected = collected;
          lastEnterLogTime = now;
        } else {
          logger.debug(`enterToFindBlock: collected=${collected}, target=${targets.amount}, shouldTransition=${shouldGo}`);
        }
      }
      return shouldGo;
    },
    onTransition: () => {
      pathfindingFailureCount = 0; // Reset counter when starting a new find block sequence
      pathfindingGiveUpLogged = false;
      missingToolInfo = null;
      lastFindFailTime = null;
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
      const now = Date.now();
      const lastLog = lastFindFailLogTimeByBlock.get(targets.blockName) || 0;
      if (now - lastLog > 2000) {
        logger.error(`BehaviorCollectBlock: find block -> exit (could not find ${targets.blockName})`);
        lastFindFailLogTimeByBlock.set(targets.blockName, now);
      } else {
        logger.debug(`BehaviorCollectBlock: find block -> exit (could not find ${targets.blockName})`);
      }
      lastFindFailTime = now;
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
        
        // Adjust distance based on target position relative to bot
        if (bot.entity && bot.entity.position && targets.blockPosition) {
          const botPos = bot.entity.position;
          const targetPos = targets.blockPosition;
          const dx = Math.abs(targetPos.x - botPos.x);
          const dz = Math.abs(targetPos.z - botPos.z);
          const dy = targetPos.y - botPos.y;
          
          // If target is directly above or below (small horizontal distance)
          if (dx < 1.5 && dz < 1.5) {
            // Use smaller distance for vertical mining
            goToBlock.distance = Math.max(0.5, Math.abs(dy) - 1);
            logger.debug(`Target is vertical (dx=${dx.toFixed(1)}, dz=${dz.toFixed(1)}, dy=${dy.toFixed(1)}), using distance ${goToBlock.distance.toFixed(1)}`);
          } else {
            // Use standard distance for horizontal mining
            goToBlock.distance = 3;
          }
        }
        
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
      logger.error(
        `BehaviorCollectBlock: cannot collect ${blockName} - missing required tool ${required}`
      );
      missingToolInfo = null;
    }
  });

  const obstructionTargets: BreakBlockTargets = {};
  const breakObstruction = createBreakBlockOnlyState(bot, obstructionTargets);
  if (breakObstruction && typeof breakObstruction === 'object') {
    (breakObstruction as any).stateName =
      (breakObstruction as any).stateName || 'BreakObstruction';
  }

  const checkObstruction = new BehaviorIdle();
  checkObstruction.stateName = 'CheckObstruction';

  let obstructionAttempts = 0;
  const MAX_OBSTRUCTION_ATTEMPTS = 12;

  checkObstruction.onStateEntered = function () {
    try {
      const obstruction = findObstructingBlock(bot, targets);
      if (obstruction && obstruction.position) {
        obstructionTargets.position = obstruction.position;
        obstructionTargets.blockPosition = obstruction.position;
        obstructionTargets.blockName = obstruction.name || 'unknown';
        logger.info(
          `BehaviorCollectBlock: obstruction ${obstructionTargets.blockName} at (${obstruction.position.x}, ${obstruction.position.y}, ${obstruction.position.z})`
        );
      } else {
        obstructionTargets.position = undefined;
        obstructionTargets.blockPosition = undefined;
        obstructionTargets.blockName = undefined;
        const canSee = canSeeTargetBlock(bot, targets);
        logger.debug(`BehaviorCollectBlock: obstruction clear (canSee=${canSee})`);
      }
    } catch (err: any) {
      obstructionTargets.position = undefined;
      obstructionTargets.blockPosition = undefined;
      obstructionTargets.blockName = undefined;
      logger.debug(
        `BehaviorCollectBlock: obstruction check failed: ${err?.message || err}`
      );
    }
  };

  const goToBlockToMine = new StateTransition({
    parent: goToBlock,
    child: mineBlock,
    name: 'BehaviorCollectBlock: go to block -> mine block',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      const canSee = canSeeTargetBlock(bot, targets);
      
      if (!finished) return false;
      if (distance >= 3) {
        logger.debug(`BehaviorCollectBlock: goToBlockToMine - distance ${distance.toFixed(2)} >= 3, not close enough yet`);
        return false;
      }
      
      if (!canSee) return false;
      
      if (isTargetUnderFeet()) {
        logger.warn('BehaviorCollectBlock: Target is directly under bot feet, cannot mine');
        return false;
      }
      
      logger.info(`BehaviorCollectBlock: reached target block at distance ${distance.toFixed(2)}, can see target, proceeding to mine`);
      return true;
    },
    onTransition: () => {
      obstructionAttempts = 0;
      pathfindingFailureCount = 0;
      targets.position = targets.blockPosition;
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
      const canSee = canSeeTargetBlock(bot, targets);
      
      if (!finished) return false;
      if (distance >= 3) return false;
      if (!canSee) return false;
      
      return isTargetUnderFeet();
    },
    onTransition: () => {
      pathfindingFailureCount = 0;
      logger.debug('go to block -> find block (avoiding block under feet)');
    }
  });

  const goToBlockToCheckObstructions = new StateTransition({
    parent: goToBlock,
    child: checkObstruction,
    name: 'BehaviorCollectBlock: go to block -> check obstructions',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      const canSee = canSeeTargetBlock(bot, targets);
      
      if (!finished) return false;
      if (distance >= 3) {
        logger.debug(`BehaviorCollectBlock: goToBlockToCheckObstructions - distance ${distance.toFixed(2)} >= 3, not close enough to check obstructions`);
        return false;
      }
      
      const shouldCheck = !canSee;
      if (shouldCheck) {
        logger.info(`BehaviorCollectBlock: reached target at distance ${distance.toFixed(2)}, but cannot see target, checking for obstructions`);
      }
      
      return shouldCheck;
    },
    onTransition: () => {
      obstructionAttempts = 0;
      logger.debug('BehaviorCollectBlock: go to block -> check obstructions');
    }
  });

  const checkObstructionToBreak = new StateTransition({
    parent: checkObstruction,
    child: breakObstruction,
    name: 'BehaviorCollectBlock: check obstructions -> break obstruction',
    shouldTransition: () =>
      !!obstructionTargets.position && obstructionAttempts < MAX_OBSTRUCTION_ATTEMPTS,
    onTransition: () => {
      obstructionAttempts++;
      const pos = obstructionTargets.position as Vec3Like;
      const name = obstructionTargets.blockName || 'unknown';
      logger.info(
        `BehaviorCollectBlock: clearing obstruction ${obstructionAttempts}/${MAX_OBSTRUCTION_ATTEMPTS} (${name}) at (${pos.x}, ${pos.y}, ${pos.z})`
      );
    }
  });

  const breakObstructionToCheck = new StateTransition({
    parent: breakObstruction,
    child: checkObstruction,
    name: 'BehaviorCollectBlock: break obstruction -> recheck',
    shouldTransition: () => {
      if (typeof breakObstruction.isFinished === 'function') {
        return breakObstruction.isFinished();
      }
      return !!breakObstruction.isFinished;
    },
    onTransition: () => {
      obstructionTargets.position = undefined;
      obstructionTargets.blockPosition = undefined;
      obstructionTargets.blockName = undefined;
    }
  });

  const checkObstructionToMine = new StateTransition({
    parent: checkObstruction,
    child: mineBlock,
    name: 'BehaviorCollectBlock: check obstructions -> mine block',
    shouldTransition: () => {
      if (isTargetUnderFeet()) return false;
      if (obstructionTargets.position) {
        return obstructionAttempts >= MAX_OBSTRUCTION_ATTEMPTS;
      }
      return true;
    },
    onTransition: () => {
      if (obstructionTargets.position) {
        logger.warn(
          `BehaviorCollectBlock: obstruction clearing exceeded ${MAX_OBSTRUCTION_ATTEMPTS} attempts, proceeding anyway`
        );
      } else if (!canSeeTargetBlock(bot, targets)) {
        logger.warn(
          'BehaviorCollectBlock: no obstruction detected but target still not visible, proceeding'
        );
      }
      obstructionAttempts = 0;
      pathfindingFailureCount = 0;
      targets.position = targets.blockPosition;
      logger.debug('check obstructions -> mine block');
    }
  });

  const checkObstructionToFindBlockUnderFeet = new StateTransition({
    parent: checkObstruction,
    child: findBlock,
    name: 'BehaviorCollectBlock: check obstructions -> find block (target under feet)',
    shouldTransition: () => {
      if (!isTargetUnderFeet()) return false;
      if (obstructionTargets.position) {
        return obstructionAttempts >= MAX_OBSTRUCTION_ATTEMPTS;
      }
      return true;
    },
    onTransition: () => {
      pathfindingFailureCount = 0;
      logger.debug('check obstructions -> find block (avoiding block under feet)');
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

  const goToBlockToFindBlock = new StateTransition({
    parent: goToBlock,
    child: findBlock,
    name: 'BehaviorCollectBlock: go to block -> find block',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      
      if (!finished || distance < 3) return false;

      if (pathfindingFailureCount >= MAX_PATHFINDING_FAILURES) {
        if (!pathfindingGiveUpLogged) {
          const botPos = bot.entity?.position;
          const targetPos = targets.blockPosition;
          const posInfo = botPos && targetPos 
            ? `bot at (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}), target at (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`
            : 'position info unavailable';
          logger.error(`BehaviorCollectBlock: pathfinding failed ${pathfindingFailureCount} times, giving up on ${targets.blockName}. ${posInfo}`);
          pathfindingGiveUpLogged = true;
        }
        return false;
      }

      pathfindingFailureCount++;
      const botPos = bot.entity?.position;
      const targetPos = targets.blockPosition;
      const posInfo = botPos && targetPos 
        ? `bot at (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}), target at (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`
        : 'position info unavailable';
      logger.warn(`BehaviorCollectBlock: pathfinding failed (still ${distance.toFixed(2)} blocks away from ${targets.blockName}), searching for closer block (attempt ${pathfindingFailureCount}/${MAX_PATHFINDING_FAILURES}). ${posInfo}`);
      return true;
    },
    onTransition: () => {
      logger.debug('go to block -> find block (pathfinding retry)');
    }
  });

  const goToBlockToExitPathfail = new StateTransition({
    parent: goToBlock,
    child: exit,
    name: 'BehaviorCollectBlock: go to block -> exit (pathfinding give up)',
    shouldTransition: () => pathfindingFailureCount >= MAX_PATHFINDING_FAILURES && goToBlock.isFinished(),
    onTransition: () => {
      const botPos = bot.entity?.position;
      const targetPos = targets.blockPosition;
      const posInfo = botPos && targetPos 
        ? `bot at (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}), target at (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`
        : 'position info unavailable';
      logger.error(`BehaviorCollectBlock: giving up after ${pathfindingFailureCount} pathfinding failures on ${targets.blockName}. ${posInfo}`);
      lastFailureReason = 'pathfinding';
    }
  });

  let mineBlockFinishTime: number | undefined;

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
      try {
        const pos = targets.entity && targets.entity.position;
        const botPos = bot.entity?.position;
        const dist = pos && botPos && pos.distanceTo ? pos.distanceTo(botPos).toFixed(2) : 'n/a';
        const posStr = pos ? `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})` : 'n/a';
        logger.debug(`find drop -> go to drop at ${posStr} dist ${dist}`);
      } catch (_) {
        logger.debug('find drop -> go to drop');
      }
    }
  });

  const findDropToFindBlock = new StateTransition({
    parent: findDrop,
    child: findBlock,
    name: 'BehaviorCollectBlock: find drop -> find block',
    shouldTransition: () => targets.entity === null,
    onTransition: () => {
      try {
        const items = Object.values(bot.entities || {}).filter((e) => e.displayName === 'Item');
        logger.debug('find drop -> find block (no nearby items). Nearby items count=', items.length);
      } catch (_) {
        logger.debug('find drop -> find block');
      }
      logNearbyItemMetadata('no-match');
    }
  });

  const goToDropToFindBlock = new StateTransition({
    parent: goToDrop,
    child: findBlock,
    name: 'BehaviorCollectBlock: go to drop -> find block',
    shouldTransition: () => {
      const dropTimeouts = getDropFollowTimeoutMs();
      const isValuable = isValuableBlock(targets.blockName);
      const timeout = isValuable ? dropTimeouts.valuable : dropTimeouts.common;
      const timeElapsed = Date.now() - goToBlockStartTime;
      return (goToDrop.distanceToTarget() <= 0.75 || timeElapsed > timeout) &&
        collectedCount() < targets.amount;
    },
    onTransition: () => {
      const dropTimeouts = getDropFollowTimeoutMs();
      const isValuable = isValuableBlock(targets.blockName);
      const timeout = isValuable ? dropTimeouts.valuable : dropTimeouts.common;
      const timeElapsed = Date.now() - goToBlockStartTime;
      logger.debug(`go to drop -> find block: ${timeElapsed}ms elapsed (timeout: ${timeout}ms, valuable: ${isValuable})`);
      logger.info(`Blocks collected: ${collectedCount()}/${targets.amount} ${targets.itemName}`);
      logNearbyItemMetadata('timeout');
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
    goToBlockToCheckObstructions,
    checkObstructionToBreak,
    breakObstructionToCheck,
    checkObstructionToMine,
    checkObstructionToFindBlockUnderFeet,
    goToBlockToFindBlock,
    mineBlockToFindDrop,
    findDropToGoToDrop,
    findDropToFindBlock,
    goToDropToFindBlock,
    goToDropToExit,
    goToBlockToExitPathfail
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  (stateMachine as any).resetBaseline = resetBaseline;
  (stateMachine as any).collectedCount = collectedCount;
  (stateMachine as any).getLastFailureReason = () => lastFailureReason;
  
  stateMachine.onStateExited = function() {
    logger.debug('CollectBlock: cleaning up on state exit');
    missingToolInfo = null;
    lastFailureReason = null;
    
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
  };
  
  return stateMachine;
}

export default createCollectBlockState;
