const { parentPort, workerData, isMainThread } = require('worker_threads');

const {
  StateTransition,
  BehaviorIdle,
  BehaviorFollowEntity,
  BehaviorGetClosestEntity,
  NestedStateMachine,
  BehaviorFindBlock,
  BehaviorFindInteractPosition,
  BehaviorMineBlock,
  BehaviorEquipItem,
  BehaviorMoveTo
} = require('mineflayer-statemachine');

import { getItemCountInInventory } from '../utils/inventory';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getLastSnapshotRadius } from '../utils/context';
import createSafeFindBlockState from './behaviorSafeFindBlock';
import { canSeeTargetBlock, findObstructingBlock } from '../utils/raycasting';

const minecraftData = require('minecraft-data');

const excludedPositionType = 'excludedPosition';

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

  const goToBlock = new BehaviorMoveTo(bot, targets);
  goToBlock.distance = 3.5;

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
      let best: Item | null = null;
      let bestScore = -1;
      for (const it of items) {
        if (!it || typeof it.type !== 'number') continue;
        if (!allowed.has(it.type)) continue;
        const meta = mcData.items[it.type];
        const score = meta && Number.isFinite(meta.maxDurability) ? meta.maxDurability! : 0;
        if (score > bestScore) {
          best = it;
          bestScore = score;
        }
      }
      logger.debug(`pickBestToolItemForBlock(${blockName}): selected ${best?.name || 'none'} with durability ${bestScore}`);
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
            goToBlock.distance = 3.5;
          }
        }
        
        try {
          logger.debug('moving towards position', targets.position);
        } catch (_) {}
        logger.debug('find interact position -> go to block');
      }
    }
  });

  // Track the original target block so we can restore it after clearing obstructions
  let originalTargetBlock: any = null;
  let obstructionCheckAttempts = 0;
  const MAX_OBSTRUCTION_CHECK_ATTEMPTS = 10;

  const goToBlockToEquip = new StateTransition({
    parent: goToBlock,
    child: equipBestTool,
    name: 'BehaviorCollectBlock: go to block -> equip best tool',
    shouldTransition: () => {
      const finished = goToBlock.isFinished();
      const distance = goToBlock.distanceToTarget();
      
      if (!finished) {
        return false;
      }
      
      if (distance >= 6) {
        return false;
      }
      
      // Check if we can see the target
      const canSee = canSeeTargetBlock(bot, targets);
      logger.debug(`BehaviorCollectBlock: goToBlock finished, distance=${distance.toFixed(2)}, canSee=${canSee}`);
      
      if (canSee) {
        // Clear path, proceed to mine
        if (originalTargetBlock) {
          // We were mining obstructions, but now have clear path - restore original target
          logger.info('BehaviorCollectBlock: Path cleared, proceeding to mine original target');
          originalTargetBlock = null;
          obstructionCheckAttempts = 0;
        }
        return true;
      }
      
      // Can't see target - check for obstructions
      logger.debug(`BehaviorCollectBlock: Cannot see target, checking for obstructions (attempt ${obstructionCheckAttempts + 1}/${MAX_OBSTRUCTION_CHECK_ATTEMPTS})`);
      if (obstructionCheckAttempts >= MAX_OBSTRUCTION_CHECK_ATTEMPTS) {
        logger.warn(`BehaviorCollectBlock: Tried ${obstructionCheckAttempts} times to clear path, giving up`);
        obstructionCheckAttempts = 0;
        originalTargetBlock = null;
        return true; // Proceed to mine anyway
      }
      
      // Try to find and redirect to obstruction
      const obstruction = findObstructingBlock(bot, targets);
      if (obstruction) {
        obstructionCheckAttempts++;
        // Save the original target if this is our first obstruction
        if (!originalTargetBlock) {
          originalTargetBlock = { 
            position: targets.blockPosition, 
            blockName: targets.blockName 
          };
          logger.info(`BehaviorCollectBlock: Saved original target ${originalTargetBlock.blockName} at (${originalTargetBlock.position.x}, ${originalTargetBlock.position.y}, ${originalTargetBlock.position.z})`);
        }
        
        // Redirect to mine the obstruction instead
        if (!obstruction.position || !obstruction.name) {
          logger.warn('BehaviorCollectBlock: Obstruction missing position or name, skipping');
          obstructionCheckAttempts++;
          return false;
        }
        logger.info(`BehaviorCollectBlock: Clearing obstruction ${obstructionCheckAttempts}/${MAX_OBSTRUCTION_CHECK_ATTEMPTS}: ${obstruction.name} at (${obstruction.position.x}, ${obstruction.position.y}, ${obstruction.position.z})`);
        targets.position = obstruction.position;
        targets.blockPosition = obstruction.position;
        targets.blockName = obstruction.name;
        return true;
      }
      
      // No obstruction found but can't see target - give up
      logger.warn('BehaviorCollectBlock: Cannot see target and no obstructions found, proceeding anyway');
      obstructionCheckAttempts++;
      return true;
    },
    onTransition: () => {
      targets.position = targets.blockPosition;
      try {
        equipTargets.item = pickBestToolItemForBlock(bot, targets.blockName);
        const chosen = equipTargets.item ? equipTargets.item.name : 'none';
        logger.debug('go to block -> equip best tool', chosen);
      } catch (_) {
        logger.debug('go to block -> equip best tool');
      }
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
      logger.debug('equip -> find block (avoiding block under feet)');
    }
  });

  const equipToMineBlock = new StateTransition({
    parent: equipBestTool,
    child: mineBlock,
    name: 'BehaviorCollectBlock: equip best tool -> mine block',
    shouldTransition: () => {
      // Safety check: never mine blocks directly under the bot's feet
      if (isTargetUnderFeet()) {
        return false; // equipToFindBlock will handle this
      }
      
      // If we're in obstruction clearing mode, check if we should keep clearing or proceed to original target
      if (originalTargetBlock) {
        // Check if we're about to mine the original target or an obstruction
        const currentTarget = targets.blockPosition;
        const originalPos = originalTargetBlock.position;
        
        if (!currentTarget) {
          logger.warn('equipToMineBlock: no current target, proceeding anyway');
          originalTargetBlock = null;
          obstructionCheckAttempts = 0;
          return true;
        }
        
        const miningObstruction = !(currentTarget.x === originalPos.x && 
                                      currentTarget.y === originalPos.y && 
                                      currentTarget.z === originalPos.z);
        
        if (miningObstruction) {
          // We're about to mine an obstruction, keep going
          logger.debug('equipToMineBlock: about to mine obstruction');
          return true;
        } else {
          // We're about to mine the original target, clear the flag
          logger.info('BehaviorCollectBlock: About to mine original target, clearing obstruction flag');
          originalTargetBlock = null;
          obstructionCheckAttempts = 0;
          return true;
        }
      }
      return true;
    },
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
      if (finished && distance >= 6) {
        logger.warn(`BehaviorCollectBlock: pathfinding failed (still ${distance.toFixed(2)} blocks away), searching for closer block`);
        return true;
      }
      return false;
    },
    onTransition: () => {
      logger.debug('go to block -> find block');
    }
  });

  let mineBlockFinishTime: number | undefined;
  
  const mineBlockToGoToBlock = new StateTransition({
    parent: mineBlock,
    child: goToBlock,
    name: 'BehaviorCollectBlock: mine block -> go to block (check for more obstructions)',
    shouldTransition: () => {
      if (mineBlock.isFinished && !mineBlockFinishTime) {
        mineBlockFinishTime = Date.now();
      }
      const finished = mineBlockFinishTime ? Date.now() - mineBlockFinishTime > 500 : false;
      // If we were mining an obstruction, loop back to goToBlock to re-check line of sight
      return finished && !!originalTargetBlock;
    },
    onTransition: () => {
      mineBlockFinishTime = undefined;
      logger.info(`BehaviorCollectBlock: Cleared obstruction, checking for more obstructions to original target ${originalTargetBlock.blockName}`);
      // Restore the original target so goToBlockToEquip can check line of sight and find more obstructions
      targets.blockName = originalTargetBlock.blockName;
      targets.blockPosition = originalTargetBlock.position;
      targets.position = originalTargetBlock.position;
      // Don't clear originalTargetBlock yet - we'll clear it once we successfully see and start mining the target
    }
  });
  
  const mineBlockToFindDrop = new StateTransition({
    parent: mineBlock,
    child: findDrop,
    name: 'BehaviorCollectBlock: mine block -> find drop',
    shouldTransition: () => {
      if (mineBlock.isFinished && !mineBlockFinishTime) {
        mineBlockFinishTime = Date.now();
      }
      const finished = mineBlockFinishTime ? Date.now() - mineBlockFinishTime > 500 : false;
      // If we weren't mining an obstruction, proceed to find drop normally
      return finished && !originalTargetBlock;
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
    shouldTransition: () =>
      (goToDrop.distanceToTarget() <= 0.75 || Date.now() - goToBlockStartTime > 5000) &&
      collectedCount() < targets.amount,
    onTransition: () => {
      logger.debug('go to drop -> find block:', Date.now() - goToBlockStartTime);
      logger.info(`Blocks collected: ${collectedCount()}/${targets.amount} ${targets.itemName}`);
    }
  });

  const goToDropToExit = new StateTransition({
    parent: goToDrop,
    child: exit,
    name: 'BehaviorCollectBlock: go to drop -> exit',
    shouldTransition: () =>
      (goToDrop.distanceToTarget() <= 0.75 && Date.now() - goToBlockStartTime > 1000) ||
      (collectedCount() >= targets.amount && Date.now() - goToBlockStartTime > 1000),
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
    equipToFindBlock, // Check if target is under feet before mining
    equipToMineBlock,
    goToBlockToFindBlock,
    mineBlockToGoToBlock,
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

