const Vec3 = require('vec3').Vec3;

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  BehaviorFindInteractPosition,
  BehaviorMoveTo,
  BehaviorPlaceBlock
} = require('mineflayer-statemachine');

import createClearAreaState from './behaviorClearArea';

const logger = require('../utils/logger');
const { addStateLogging } = require('../utils/stateLogging');

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  clone: () => Vec3Like;
  offset: (x: number, y: number, z: number) => Vec3Like;
  floored: () => Vec3Like;
  distanceTo: (other: Vec3Like) => number;
  [key: string]: any;
}

interface Block {
  name?: string;
  type: number;
  boundingBox?: string;
  position: Vec3Like;
  [key: string]: any;
}

type Bot = any;

interface Targets {
  item?: any;
  placePosition?: Vec3Like;
  position?: Vec3Like;
  placedPosition?: Vec3Like;
  placedConfirmed?: boolean;
  blockFace?: Vec3Like;
  referenceBlock?: Block;
  clearRadiusHorizontal?: number;
  clearRadiusVertical?: number;
  [key: string]: any;
}

function createPlaceNearState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const findPlaceCoords = new BehaviorFindInteractPosition(bot, targets);

  // Add logging to FindInteractPosition
  addStateLogging(findPlaceCoords, 'FindInteractPosition', {
    logEnter: true,
    getExtraInfo: () => {
      const pos = targets.placePosition;
      return pos ? `for placing at (${pos.x}, ${pos.y}, ${pos.z})` : '';
    }
  });

  const moveToPlaceCoords = new BehaviorMoveTo(bot, targets);
  moveToPlaceCoords.distance = 0.05;

  // Add logging to MoveTo
  addStateLogging(moveToPlaceCoords, 'MoveTo', {
    logEnter: true,
    getExtraInfo: () => {
      const pos = targets.position;
      if (!pos) return 'no position';
      const dist = bot.entity.position.distanceTo(pos).toFixed(2);
      return `to place position (${pos.x}, ${pos.y}, ${pos.z}), distance: ${dist}m`;
    }
  });

  const placeBlock = new BehaviorPlaceBlock(bot, targets);

  // Add logging to PlaceBlock (already has custom hook, extend it)
  const existingPlaceLogging = placeBlock.onStateEntered;
  addStateLogging(placeBlock, 'PlaceBlock', {
    logEnter: true,
    getExtraInfo: () => {
      const item = targets.item;
      return item ? `placing ${item.name}` : 'no item';
    }
  });
  // Restore the existing custom logic after adding logging
  if (existingPlaceLogging && typeof existingPlaceLogging === 'function') {
    const loggedOnEnter = placeBlock.onStateEntered;
    placeBlock.onStateEntered = async function (this: any) {
      if (loggedOnEnter) await loggedOnEnter.call(this);
      return existingPlaceLogging.call(this);
    };
  }
  const clearInit = new BehaviorIdle();
  const clearTargets: Targets = { placePosition: undefined, clearRadiusHorizontal: 1, clearRadiusVertical: 2 };
  const clearArea = createClearAreaState(bot, clearTargets as any);
  // Ensure the held item matches targets.item before placing (wrap original handler safely)
  const originalOnStateEntered =
    typeof placeBlock.onStateEntered === 'function' ? placeBlock.onStateEntered.bind(placeBlock) : null;
  placeBlock.onStateEntered = async () => {
    try {
      const need = targets && targets.item;
      const held = bot.heldItem;
      if (need && (!held || held.name !== need.name)) {
        await bot.equip(need, 'hand');
      }
    } catch (_) {}
    if (originalOnStateEntered) return originalOnStateEntered();
  };

  const exit = new BehaviorIdle();

  function getHeadroom(): Vec3Like {
    return targets.placePosition!.clone().offset(0, 1, 0);
  }
  function isSolidBlock(pos: Vec3Like): boolean {
    try {
      const b = bot.blockAt(pos, false);
      if (!b) return false;
      if (b.type === 0) return false;
      return b.boundingBox === 'block';
    } catch (_) {
      return false;
    }
  }
  function findSolidBaseNear(pos: Vec3Like, maxRadius: number = 2): Vec3Like | null {
    const base = pos.clone();
    base.x = Math.floor(base.x);
    base.y = Math.floor(base.y);
    base.z = Math.floor(base.z);
    let best: Vec3Like | null = null;
    for (let r = 0; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const p = base.clone().offset(dx, -1, dz);
          const above = p.clone().offset(0, 1, 0);
          if (isSolidBlock(p) && bot.world.getBlockType(above) === 0) {
            if (!best || p.distanceTo(bot.entity.position) < best.distanceTo(bot.entity.position)) best = p;
          }
        }
      }
      if (best) break;
    }
    return best;
  }
  function gatherCandidateObstructions(): Vec3Like[] {
    const head = getHeadroom();
    const list: Vec3Like[] = [];
    const h = Number.isFinite(targets.clearRadiusHorizontal)
      ? Math.max(0, Math.floor(targets.clearRadiusHorizontal!))
      : 1;
    const v = Number.isFinite(targets.clearRadiusVertical)
      ? Math.max(1, Math.floor(targets.clearRadiusVertical!))
      : 2;
    for (let dy = 0; dy < v; dy++) {
      for (let dx = -h; dx <= h; dx++)
        for (let dz = -h; dz <= h; dz++) list.push(head.clone().offset(dx, dy, dz));
    }
    return list;
  }
  function obstructedDirectionsCount(): number {
    const head = getHeadroom();
    const obstructed = { E: false, W: false, S: false, N: false };
    const list = gatherCandidateObstructions();
    for (const p of list) {
      if (bot.world.getBlockType(p) === 0) continue;
      const dx = p.x - head.x;
      const dz = p.z - head.z;
      if (Math.abs(dx) >= Math.abs(dz)) {
        if (dx > 0) obstructed.E = true;
        else if (dx < 0) obstructed.W = true;
      } else {
        if (dz > 0) obstructed.S = true;
        else if (dz < 0) obstructed.N = true;
      }
    }
    return (obstructed.E ? 1 : 0) + (obstructed.W ? 1 : 0) + (obstructed.S ? 1 : 0) + (obstructed.N ? 1 : 0);
  }
  function canPlaceNow(): boolean {
    return obstructedDirectionsCount() < 2;
  }
  function shouldClearArea(): boolean {
    return obstructedDirectionsCount() >= 2;
  }

  const enterToExit = new StateTransition({
    name: 'BehaviorPlaceNear: enter -> exit',
    parent: enter,
    child: exit,
    shouldTransition: () => targets.item == null,
    onTransition: () => {
      logger.error('BehaviorPlaceNear: enter -> exit, item is null');
    }
  });

  let placeTries = 1;
  const enterToFindPlaceCoords = new StateTransition({
    name: 'BehaviorPlaceNear: enter -> find place coords',
    parent: enter,
    child: findPlaceCoords,
    shouldTransition: () => true,
    onTransition: () => {
      logger.info('BehaviorPlaceNear: enter -> find place coords');
      placeTries = 1;
      targets.placedConfirmed = false;

      const base = bot.entity.position.clone();
      const offsetX = Math.random() < 0.5 ? -1.5 : 1.5;
      const offsetZ = Math.random() < 0.5 ? -1.5 : 1.5;
      const rough = base.clone();
      rough.x += offsetX;
      rough.z += offsetZ;
      const ground =
        findSolidBaseNear(rough) || findSolidBaseNear(base) || findSolidBaseNear(base.offset(0, 0, 0));
      if (ground) {
        const placePos = ground.clone();
        targets.placePosition = placePos;
        const center = placePos.clone();
        center.x += 0.5;
        center.y += 1;
        center.z += 0.5;
        targets.position = placePos.clone();
        targets.position.x += 0.5;
        targets.position.y += 0;
        targets.position.z += 0.5;
        logger.info('BehaviorPlaceNear: Set place base:', placePos);
        logger.info('BehaviorPlaceNear: Set target position:', targets.position);
      } else {
        const fallback = base.floored();
        fallback.y -= 1;
        targets.placePosition = fallback;
        const fallbackPos = fallback.clone();
        fallbackPos.x += 0.5;
        fallbackPos.z += 0.5;
        targets.position = fallbackPos;
        logger.info('BehaviorPlaceNear: Fallback place base:', targets.placePosition);
      }
    }
  });

  const findPlaceCoordsToMoveToPlaceCoords = new StateTransition({
    name: 'BehaviorPlaceNear: find place coords -> move to place coords',
    parent: findPlaceCoords,
    child: moveToPlaceCoords,
    shouldTransition: () => true,
    onTransition: () => {
      logger.info('BehaviorPlaceNear: find place coords -> move to place coords');
    }
  });

  let placeStartTime: number;
  const moveToPlaceCoordsToPlaceUtilityBlock = new StateTransition({
    name: 'BehaviorPlaceNear: move to place coords -> place block',
    parent: moveToPlaceCoords,
    child: placeBlock,
    shouldTransition: () => {
      if (!moveToPlaceCoords.isFinished()) return false;
      try {
        const ref = bot.blockAt(targets.placePosition, false);
        if (!ref || ref.type === 0) return false;
      } catch (_) {
        return false;
      }
      if (placeTries <= 2) return true;
      if (!canPlaceNow()) return false;
      return true;
    },
    onTransition: () => {
      placeStartTime = Date.now();
      logger.info('BehaviorPlaceNear: move to place coords -> place block');
      targets.position = targets.placePosition;
      targets.blockFace = new Vec3(0, 1, 0);

      if (targets.position) {
        targets.placedPosition = targets.position.clone();
        targets.placedPosition.y += 1;
      }
      try {
        targets.referenceBlock = bot.blockAt(targets.placePosition, false);
      } catch (_) {}
    }
  });

  // Multi-block clear loop delegated to behaviorClearArea
  const moveToPlaceCoordsToClearInit = new StateTransition({
    name: 'BehaviorPlaceNear: move to place coords -> clear init',
    parent: moveToPlaceCoords,
    child: clearInit,
    shouldTransition: () =>
      moveToPlaceCoords.isFinished() && placeTries >= 3 && shouldClearArea() && placeTries < 5,
    onTransition: () => {
      clearTargets.placePosition = targets.placePosition!.clone();
      clearTargets.clearRadiusHorizontal = Number.isFinite(targets.clearRadiusHorizontal)
        ? targets.clearRadiusHorizontal
        : Number.isFinite(clearTargets.clearRadiusHorizontal)
          ? clearTargets.clearRadiusHorizontal
          : 1;
      clearTargets.clearRadiusVertical = Number.isFinite(targets.clearRadiusVertical)
        ? targets.clearRadiusVertical
        : Number.isFinite(clearTargets.clearRadiusVertical)
          ? clearTargets.clearRadiusVertical
          : 2;
      logger.info(
        'BehaviorPlaceNear: clear init -> queued area with radii',
        clearTargets.clearRadiusHorizontal,
        clearTargets.clearRadiusVertical
      );
    }
  });

  const clearInitToClearArea = new StateTransition({
    name: 'BehaviorPlaceNear: clear init -> clear area',
    parent: clearInit,
    child: clearArea,
    shouldTransition: () => !!clearTargets.placePosition,
    onTransition: () => {}
  });

  const clearAreaToPlaceGate = new StateTransition({
    name: 'BehaviorPlaceNear: clear area -> place gate',
    parent: clearArea,
    child: moveToPlaceCoords,
    shouldTransition: () =>
      typeof clearArea.isFinished === 'function' ? clearArea.isFinished() && canPlaceNow() : canPlaceNow(),
    onTransition: () => {
      logger.info('BehaviorPlaceNear: clearing complete');
    }
  });

  const clearAreaToReposition = new StateTransition({
    name: 'BehaviorPlaceNear: clear area -> reposition',
    parent: clearArea,
    child: findPlaceCoords,
    shouldTransition: () => {
      const finished = typeof clearArea.isFinished === 'function' ? clearArea.isFinished() : true;
      return finished && !canPlaceNow();
    },
    onTransition: () => {
      logger.info('BehaviorPlaceNear: clearing capped or still obstructed -> reposition');
      placeTries++;
    }
  });

  const placeUtilityBlockToFindPlaceCoords = new StateTransition({
    name: 'BehaviorPlaceNear: place block -> find place coords',
    parent: placeBlock,
    child: findPlaceCoords,
    shouldTransition: () => {
      // Wait a bit after placement attempt
      if (Date.now() - placeStartTime < 1000) return false;

      // Don't retry if we've exceeded max tries
      if (placeTries >= 8) return false;

      // Check if block was actually placed
      const blockType = bot.world.getBlockType(targets.placedPosition);
      if (blockType !== 0) return false; // Block exists, don't retry

      // Block not placed - retry with different position
      return true;
    },
    onTransition: () => {
      logger.info(
        `BehaviorPlaceNear: place block -> find place coords (retry ${placeTries}, block placement failed)`
      );
      placeTries++;
    }
  });

  const placeUtilityBlockToExit = new StateTransition({
    name: 'BehaviorPlaceNear: place block -> exit',
    parent: placeBlock,
    child: exit,
    shouldTransition: () => {
      // Wait minimum time for block update
      if (Date.now() - placeStartTime < 500) return false;

      const blockType = bot.world.getBlockType(targets.placedPosition);

      // SUCCESS: Block was placed successfully
      if (blockType !== 0) {
        return true;
      }

      // FAILURE: Exceeded retries without success
      if (placeTries >= 8) {
        logger.error('BehaviorPlaceNear: Max retries exceeded, placement failed');
        return true;
      }

      // Keep trying
      return false;
    },
    onTransition: () => {
      const blockType = bot.world.getBlockType(targets.placedPosition);
      const success = blockType !== 0;

      if (success) {
        logger.info('BehaviorPlaceNear: place block -> exit (SUCCESS)');
        logger.info('Block at place position:', blockType);
        try {
          const blk = bot.blockAt(targets.placedPosition, false);
          targets.placedConfirmed = !!(blk && blk.name);
          if (targets.placedConfirmed) {
            logger.info(`BehaviorPlaceNear: Confirmed placement of ${blk.name}`);
          }
        } catch (_) {
          targets.placedConfirmed = false;
        }
      } else {
        logger.error('BehaviorPlaceNear: place block -> exit (FAILED after max retries)');
        logger.error('Block at place position:', blockType, '(expected non-zero)');
        targets.placedConfirmed = false;
      }
    }
  });

  const transitions = [
    enterToExit,
    enterToFindPlaceCoords,
    findPlaceCoordsToMoveToPlaceCoords,
    moveToPlaceCoordsToClearInit,
    clearInitToClearArea,
    clearAreaToPlaceGate,
    moveToPlaceCoordsToPlaceUtilityBlock,
    placeUtilityBlockToFindPlaceCoords,
    placeUtilityBlockToExit,
    clearAreaToReposition
  ];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createPlaceNearState;

