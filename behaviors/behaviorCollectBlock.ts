const { parentPort, workerData, isMainThread } = require('worker_threads');

const {
  StateTransition,
  BehaviorIdle,
  BehaviorFollowEntity,
  BehaviorGetClosestEntity,
  NestedStateMachine,
  BehaviorFindBlock,
  BehaviorFindInteractPosition,
  BehaviorEquipItem
} = require('mineflayer-statemachine');

import { BehaviorMineBlock } from './behaviorMineBlock';
import { BehaviorSmartMoveTo } from './behaviorSmartMoveTo';
import createBreakBlockOnlyState, { BreakBlockTargets } from './behaviorBreakBlockOnly';

import { getItemCountInInventory } from '../utils/inventory';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getLastSnapshotRadius } from '../utils/context';
import createSafeFindBlockState from './behaviorSafeFindBlock';
import { canSeeTargetBlock, findObstructingBlock } from '../utils/raycasting';
import { ExecutionContext } from '../bots/collector/execution_context';
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

interface EquipTargets {
  item: Item | null;
}

interface MinecraftData {
  blocksByName: Record<string, { id?: number; harvestTools?: Record<string, any> }>;
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

  function collectedCount(): number {
    return getItemCountInInventory(bot, targets.itemName) - currentBlockCount;
  }

  function resetBaseline(): void {
    currentBlockCount = getItemCountInInventory(bot, targets.itemName);
    logger.debug(`resetBaseline: currentBlockCount set to ${currentBlockCount} for ${targets.itemName}`);
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

  const equipTargets: EquipTargets = { item: null };
  const equipBestTool = new BehaviorEquipItem(bot, equipTargets);

  // Add logging to EquipItem
  addStateLogging(equipBestTool, 'EquipItem', {
    logEnter: true,
    getExtraInfo: () => (equipTargets.item ? `equipping ${equipTargets.item.name}` : 'no item to equip')
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

  function pickBestToolItemForBlock(bot: Bot, blockName: string): Item | null {
    try {
      const blockInfo = mcData.blocksByName[blockName];
      const items = bot.inventory?.items?.() || [];
      const allowed =
        blockInfo && blockInfo.harvestTools
          ? new Set(Object.keys(blockInfo.harvestTools).map((id) => Number(id)))
          : null;
      if (!allowed || allowed.size === 0) return null;

      // Tier order: wooden(0), stone(1), iron(2), golden(3), diamond(4), netherite(5)
      const toolTiers = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];
      const getToolTier = (itemName: string): number => {
        for (let i = 0; i < toolTiers.length; i++) {
          if (itemName.startsWith(toolTiers[i])) return i;
        }
        return -1;
      };

      // First, find the highest tier available
      let highestTier = -1;
      for (const it of items) {
        if (!it || typeof it.type !== 'number' || !it.name) continue;
        if (!allowed.has(it.type)) continue;
        const meta = mcData.items[it.type];
        const maxDurability = meta && Number.isFinite(meta.maxDurability) ? meta.maxDurability! : 0;
        const durabilityUsed = it.durabilityUsed || 0;
        const remainingUses = maxDurability - durabilityUsed;
        if (remainingUses <= 0) continue;

        const tier = getToolTier(it.name);
        if (tier > highestTier) {
          highestTier = tier;
        }
      }

      if (highestTier === -1) return null;

      // Then, among tools of the highest tier, select the one with lowest remaining uses
      let best: Item | null = null;
      let lowestRemainingUses = Infinity;
      for (const it of items) {
        if (!it || typeof it.type !== 'number' || !it.name) continue;
        if (!allowed.has(it.type)) continue;
        const tier = getToolTier(it.name);
        if (tier !== highestTier) continue; // Only consider highest tier

        const meta = mcData.items[it.type];
        const maxDurability = meta && Number.isFinite(meta.maxDurability) ? meta.maxDurability! : 0;
        const durabilityUsed = it.durabilityUsed || 0;
        const remainingUses = maxDurability - durabilityUsed;
        
        if (remainingUses < lowestRemainingUses && remainingUses > 0) {
          best = it;
          lowestRemainingUses = remainingUses;
        }
      }
      
      const tierName = highestTier >= 0 ? toolTiers[highestTier] : 'unknown';
      logger.debug(`pickBestToolItemForBlock(${blockName}): selected ${best?.name || 'none'} (${tierName} tier) with ${lowestRemainingUses === Infinity ? 0 : lowestRemainingUses} uses remaining`);
      return best;
    } catch (_) {
      return null;
    }
  }

  const findDrop = new BehaviorGetClosestEntity(bot, targets, (entity: Entity) => {
    const botPos = bot.entity?.position;
    if (!botPos || !entity.position.distanceTo) return false;
    const isItem = entity.displayName === 'Item' || entity.name === 'item' || entity.type === 'object';
    const inRange = entity.position.distanceTo(botPos) < 8;
    if (isItem && inRange) {
      logger.debug(`Found drop entity: displayName=${entity.displayName}, name=${entity.name}, type=${entity.type}`);
    }
    return isItem && inRange;
  });

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

  const enterToFindBlock = new StateTransition({
    parent: enter,
    child: findBlock,
    name: 'BehaviorCollectBlock: enter -> find block',
    shouldTransition: () => {
      if (!baselineInitialized && targets.itemName) {
        resetBaseline();
        baselineInitialized = true;
      }
      const collected = collectedCount();
      const shouldGo = collected < targets.amount;
      logger.info(`enterToFindBlock: collected=${collected}, target=${targets.amount}, shouldTransition=${shouldGo}`);
      return shouldGo;
    },
    onTransition: () => {
      pathfindingFailureCount = 0; // Reset counter when starting a new find block sequence
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
      logger.error(`BehaviorCollectBlock: find block -> exit (could not find ${targets.blockName})`);
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
    shouldTransition: () => true,
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

  function prepareToEquip(context: string): void {
    pathfindingFailureCount = 0;
    targets.position = targets.blockPosition;
    try {
      equipTargets.item = pickBestToolItemForBlock(bot, targets.blockName);
      const chosen = equipTargets.item ? equipTargets.item.name : 'none';
      logger.debug(`${context}: equip best tool`, chosen);
    } catch (_) {
      logger.debug(`${context}: equip best tool`);
    }
  }

  const goToBlockToEquip = new StateTransition({
    parent: goToBlock,
    child: equipBestTool,
    name: 'BehaviorCollectBlock: go to block -> equip best tool',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      const canSee = canSeeTargetBlock(bot, targets);
      
      logger.debug(
        `BehaviorCollectBlock: goToBlockToEquip check - finished=${finished}, distance=${distance.toFixed(2)}, canSee=${canSee}, target=${targets.blockPosition ? `(${targets.blockPosition.x}, ${targets.blockPosition.y}, ${targets.blockPosition.z})` : 'unknown'}`
      );
      
      if (!finished) return false;
      if (distance >= 3) {
        logger.debug(`BehaviorCollectBlock: goToBlockToEquip - distance ${distance.toFixed(2)} >= 3, not close enough yet`);
        return false;
      }
      
      if (canSee) {
        logger.info(`BehaviorCollectBlock: reached target block at distance ${distance.toFixed(2)}, can see target, proceeding to equip`);
      }
      
      return canSee;
    },
    onTransition: () => {
      obstructionAttempts = 0;
      prepareToEquip('go to block');
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

  const checkObstructionToEquip = new StateTransition({
    parent: checkObstruction,
    child: equipBestTool,
    name: 'BehaviorCollectBlock: check obstructions -> equip best tool',
    shouldTransition: () => {
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
      prepareToEquip('check obstructions');
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

  const equipToFindBlock = new StateTransition({
    parent: equipBestTool,
    child: findBlock,
    name: 'BehaviorCollectBlock: equip -> find block (target under feet)',
    shouldTransition: () => {
      if (isTargetUnderFeet()) {
        logger.warn('BehaviorCollectBlock: Target is directly under bot feet, cannot mine - finding different block');
        return true;
      }
      return false;
    },
    onTransition: () => {
      pathfindingFailureCount = 0; // Reset counter when searching for a different block
      logger.debug('equip -> find block (avoiding block under feet)');
    }
  });

  const equipToMineBlock = new StateTransition({
    parent: equipBestTool,
    child: mineBlock,
    name: 'BehaviorCollectBlock: equip best tool -> mine block',
    shouldTransition: () => !isTargetUnderFeet(),
    onTransition: () => {
      logger.debug('equip best tool -> mine block');
    }
  });

  const goToBlockToFindBlock = new StateTransition({
    parent: goToBlock,
    child: findBlock,
    name: 'BehaviorCollectBlock: go to block -> find block',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      
      if (finished && distance >= 3) {
        pathfindingFailureCount++;
        const botPos = bot.entity?.position;
        const targetPos = targets.blockPosition;
        const posInfo = botPos && targetPos 
          ? `bot at (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}), target at (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`
          : 'position info unavailable';
        
        if (pathfindingFailureCount >= MAX_PATHFINDING_FAILURES) {
          logger.error(`BehaviorCollectBlock: pathfinding failed ${pathfindingFailureCount} times, giving up on ${targets.blockName}. ${posInfo}`);
          return false;
        }
        logger.warn(`BehaviorCollectBlock: pathfinding failed (still ${distance.toFixed(2)} blocks away from ${targets.blockName}), searching for closer block (attempt ${pathfindingFailureCount}/${MAX_PATHFINDING_FAILURES}). ${posInfo}`);
        return true;
      }
      return false;
    },
    onTransition: () => {
      logger.debug('go to block -> find block (pathfinding retry)');
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
    enterToFindBlock,
    findBlockToExit,
    findBlockToFindInteractPosition,
    findInteractPositionToGoToBlock,
    goToBlockToEquip,
    goToBlockToCheckObstructions,
    checkObstructionToBreak,
    breakObstructionToCheck,
    checkObstructionToEquip,
    equipToFindBlock, // Check if target is under feet before mining
    equipToMineBlock,
    goToBlockToFindBlock,
    mineBlockToFindDrop,
    findDropToGoToDrop,
    findDropToFindBlock,
    goToDropToFindBlock,
    goToDropToExit
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  (stateMachine as any).resetBaseline = resetBaseline;
  (stateMachine as any).collectedCount = collectedCount;
  
  stateMachine.onStateExited = function() {
    logger.debug('CollectBlock: cleaning up on state exit');
    
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

