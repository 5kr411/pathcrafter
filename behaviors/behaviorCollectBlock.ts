const { parentPort, workerData, isMainThread } = require('worker_threads');

const {
  StateTransition,
  BehaviorIdle,
  BehaviorFollowEntity,
  BehaviorGetClosestEntity,
  NestedStateMachine,
  BehaviorFindBlock,
  BehaviorFindInteractPosition,
  BehaviorMoveTo,
  BehaviorMineBlock,
  BehaviorEquipItem
} = require('mineflayer-statemachine');

import { getItemCountInInventory } from '../utils/inventory';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getLastSnapshotRadius } from '../utils/context';
import createSafeFindBlockState from './behaviorSafeFindBlock';

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
  itemsById: Record<number, { maxDurability?: number }>;
}

function createCollectBlockState(bot: Bot, targets: Targets): any {
  const mcData: MinecraftData = minecraftData(bot.version);
  let initialId = mcData.blocksByName[targets.blockName]?.id;
  try {
    logger.debug(
      `init -> block=${targets.blockName}#${initialId}, item=${targets.itemName}, amount=${targets.amount}`
    );
  } catch (_) {}

  const currentBlockCount = getItemCountInInventory(bot, targets.itemName);

  function collectedCount(): number {
    return getItemCountInInventory(bot, targets.itemName) - currentBlockCount;
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
  goToBlock.distance = 0.5;
  goToBlock.movements.allow1by1towers = true;
  goToBlock.movements.canOpenDoors = true;
  goToBlock.movements.allowSprinting = true;
  goToBlock.movements.canDig = true;

  // Add logging to MoveTo
  addStateLogging(goToBlock, 'MoveTo', {
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
        const meta = mcData.itemsById[it.type];
        const score = meta && Number.isFinite(meta.maxDurability) ? meta.maxDurability! : 0;
        if (score > bestScore) {
          best = it;
          bestScore = score;
        }
      }
      return best;
    } catch (_) {
      return null;
    }
  }

  const findDrop = new BehaviorGetClosestEntity(bot, targets, (entity: Entity) => {
    const botPos = bot.entity?.position;
    if (!botPos || !entity.position.distanceTo) return false;
    return entity.displayName === 'Item' && entity.position.distanceTo(botPos) < 8;
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

  const enterToFindBlock = new StateTransition({
    parent: enter,
    child: findBlock,
    name: 'BehaviorCollectBlock: enter -> find block',
    shouldTransition: () => collectedCount() < targets.amount,
    onTransition: () => {
      try {
        const currentId = mcData.blocksByName[targets.blockName]?.id;
        if (currentId != null) findBlock.blocks = [currentId];
        // Keep search radius in sync with snapshot radius on each entry
        try {
          const r = Number(getLastSnapshotRadius && getLastSnapshotRadius());
          if (Number.isFinite(r) && r > 0) findBlock.maxDistance = r;
        } catch (_) {}
        logger.debug(`enter -> find block (target=${targets.blockName}#${currentId})`);
      } catch (_) {
        logger.debug('enter -> find block');
      }
    }
  });

  const findBlockToExit = new StateTransition({
    parent: findBlock,
    child: exit,
    name: 'BehaviorCollectBlock: find block -> exit',
    shouldTransition: () => targets.position === undefined,
    onTransition: () => {
      logger.error(`BehaviorCollectBlock: find block -> exit (could not find ${targets.blockName})`);
    }
  });

  const findBlockToFindInteractPosition = new StateTransition({
    parent: findBlock,
    child: findInteractPosition,
    name: 'BehaviorCollectBlock: find block -> find interact position',
    shouldTransition: () => targets.position !== undefined,
    onTransition: () => {
      targets.blockPosition = targets.position;
      logger.debug('find block -> find interact position');
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
        try {
          logger.debug('moving towards position', targets.position);
        } catch (_) {}
        logger.debug('find interact position -> go to block');
      }
    }
  });

  const goToBlockToEquip = new StateTransition({
    parent: goToBlock,
    child: equipBestTool,
    name: 'BehaviorCollectBlock: go to block -> equip best tool',
    shouldTransition: () => goToBlock.isFinished() && goToBlock.distanceToTarget() < 6,
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

  const equipToMineBlock = new StateTransition({
    parent: equipBestTool,
    child: mineBlock,
    name: 'BehaviorCollectBlock: equip best tool -> mine block',
    shouldTransition: () => true,
    onTransition: () => {
      logger.debug('equip best tool -> mine block');
    }
  });

  const goToBlockToFindBlock = new StateTransition({
    parent: goToBlock,
    child: findBlock,
    name: 'BehaviorCollectBlock: go to block -> find block',
    shouldTransition: () => goToBlock.isFinished() && goToBlock.distanceToTarget() >= 6,
    onTransition: () => {
      logger.debug('go to block -> find block');
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
      return mineBlockFinishTime ? Date.now() - mineBlockFinishTime > 500 : false;
    },
    onTransition: () => {
      mineBlockFinishTime = undefined;
      try {
        const t = targets.blockPosition;
        const type = t ? bot.world?.getBlockType(t) : undefined;
        logger.debug('mine block -> find drop (post-mine blockType=', type, ')');
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
    equipToMineBlock,
    goToBlockToFindBlock,
    mineBlockToFindDrop,
    findDropToGoToDrop,
    findDropToFindBlock,
    goToDropToFindBlock,
    goToDropToExit
  ];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createCollectBlockState;

