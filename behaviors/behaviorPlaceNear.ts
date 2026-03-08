const Vec3 = require('vec3').Vec3;

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import createClearAreaState from './behaviorClearArea';
import { BehaviorSmartMoveTo } from './behaviorSmartMoveTo';

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';

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
  const moveToPlaceCoords = new BehaviorSmartMoveTo(bot, targets);
  moveToPlaceCoords.distance = 2;

  addStateLogging(moveToPlaceCoords, 'MoveTo', {
    logEnter: true,
    getExtraInfo: () => {
      const pos = targets.position;
      if (!pos) return 'no position';
      const dist = bot.entity.position.distanceTo(pos).toFixed(2);
      return `to place position (${pos.x}, ${pos.y}, ${pos.z}), distance: ${dist}m`;
    }
  });

  // Direct placement state — equip + placeBlock in one await chain, no race conditions
  const placeBlock = new BehaviorIdle();
  placeBlock.onStateEntered = async () => {
    try {
      const need = targets.item;
      if (need) {
        const held = bot.heldItem;
        if (!held || held.name !== need.name) {
          await bot.equip(need, 'hand');
        }
      }
      const block = bot.blockAt(targets.placePosition, false);
      if (!block || block.type === 0) {
        logger.warn('BehaviorPlaceNear: reference block missing for placement');
        return;
      }
      // Look at the top face of the reference block before placing
      const topFace = block.position.clone().offset(0.5, 1, 0.5);
      await bot.lookAt(topFace, true);
      logger.info(`BehaviorPlaceNear: placing ${need?.name} on ${block.name} at (${block.position.x},${block.position.y},${block.position.z})`);
      await bot.placeBlock(block, targets.blockFace);
    } catch (err: any) {
      logger.warn(`BehaviorPlaceNear: placeBlock error: ${err.message || err}`);
    }
  };

  const clearTargets: Targets = { placePosition: undefined, clearRadiusHorizontal: 1, clearRadiusVertical: 2 };
  const clearArea = createClearAreaState(bot, clearTargets as any);
  const exit = new BehaviorIdle();

  // --- Spot selection ---
  function findSpot(): boolean {
    targets.placedConfirmed = false;
    const botPos = bot.entity.position.clone().floored();
    const candidates: { ground: Vec3Like; dist: number }[] = [];

    for (let dy = -2; dy <= 1; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        for (let dz = -6; dz <= 6; dz++) {
          const hdist = Math.sqrt(dx * dx + dz * dz);
          if (hdist < 1.5 || hdist > 8) continue;
          const ground = botPos.clone().offset(dx, dy, dz);
          try {
            const b = bot.blockAt(ground, false);
            if (!b || b.type === 0 || b.boundingBox !== 'block') continue;
            const above = ground.clone().offset(0, 1, 0);
            if (bot.world.getBlockType(above) !== 0) continue;
          } catch (_) {
            continue;
          }
          candidates.push({ ground, dist: hdist });
        }
      }
    }

    candidates.sort((a, b) => a.dist - b.dist);

    const best = candidates.length > 0 ? candidates[0].ground : null;

    if (!best) {
      logger.error('BehaviorPlaceNear: No valid placement location found');
      targets.placePosition = undefined;
      targets.position = undefined;
      return false;
    }

    targets.placePosition = best.clone();
    // Set moveTo target to the air space above the ground block — SmartMoveTo (distance=2) walks within placement reach
    standingPosition = best.offset(0, 1, 0);
    targets.position = standingPosition;
    logger.info(`BehaviorPlaceNear: Selected place base at (${best.x}, ${best.y}, ${best.z}), hdist=${candidates[0].dist.toFixed(1)}`);
    return true;
  }

  // --- Transition helpers ---
  let moveStartTime = 0;
  let placeStartTime = 0;
  let clearedOnce = false;
  let standingPosition: Vec3Like | undefined = undefined;
  const moveTimeoutMs = 15000;

  function setupPlaceTransition() {
    targets.blockFace = new Vec3(0, 1, 0);
    if (targets.placePosition) {
      targets.placedPosition = targets.placePosition.clone();
      targets.placedPosition.y += 1;
    }
    placeStartTime = Date.now();
  }

  function restoreStandingPosition() {
    // After placement attempt, restore moveTo target for potential retry
    if (standingPosition) {
      targets.position = standingPosition;
    }
  }

  function isRefSolid(): boolean {
    try {
      const ref = bot.blockAt(targets.placePosition, false);
      return !!(ref && ref.type !== 0);
    } catch (_) {
      return false;
    }
  }

  function blockPlacedCorrectly(): boolean {
    const placedBlock = targets.placedPosition ? bot.blockAt(targets.placedPosition, false) : null;
    if (!placedBlock || placedBlock.type === 0) return false;
    const desiredName = targets.item?.name;
    return !desiredName || placedBlock.name === desiredName;
  }

  function isObstructed(): boolean {
    if (!targets.placePosition) return false;
    const head = targets.placePosition.clone().offset(0, 1, 0);
    const h = Number.isFinite(targets.clearRadiusHorizontal)
      ? Math.max(0, Math.floor(targets.clearRadiusHorizontal!))
      : 1;
    const v = Number.isFinite(targets.clearRadiusVertical)
      ? Math.max(1, Math.floor(targets.clearRadiusVertical!))
      : 2;
    for (let dy = 0; dy < v; dy++)
      for (let dx = -h; dx <= h; dx++)
        for (let dz = -h; dz <= h; dz++)
          if (bot.world.getBlockType(head.clone().offset(dx, dy, dz)) !== 0) return true;
    return false;
  }

  // --- Transitions ---

  // 1. enter → exit: no item
  const enterToExit = new StateTransition({
    name: 'PlaceNear: enter → exit (no item)',
    parent: enter,
    child: exit,
    shouldTransition: () => targets.item == null,
    onTransition: () => {
      logger.error('BehaviorPlaceNear: no item set');
    }
  });

  // 2. enter → moveTo: findSpot succeeds
  const enterToMove = new StateTransition({
    name: 'PlaceNear: enter → moveTo',
    parent: enter,
    child: moveToPlaceCoords,
    shouldTransition: () => true,
    onTransition: () => {
      clearedOnce = false;
      if (!findSpot()) return; // will fall through to exit via move timeout
      moveStartTime = Date.now();
    }
  });

  // 3. moveTo → placeBlock: arrived and ref is solid
  const moveToPlace = new StateTransition({
    name: 'PlaceNear: moveTo → placeBlock',
    parent: moveToPlaceCoords,
    child: placeBlock,
    shouldTransition: () => moveToPlaceCoords.isFinished() && isRefSolid(),
    onTransition: () => {
      logger.info('BehaviorPlaceNear: arrived, placing block');
      setupPlaceTransition();
    }
  });

  // 4. moveTo → exit: timeout or ref missing after arrival
  const moveToExit = new StateTransition({
    name: 'PlaceNear: moveTo → exit (timeout/ref missing)',
    parent: moveToPlaceCoords,
    child: exit,
    shouldTransition: () => {
      if (Date.now() - moveStartTime > moveTimeoutMs) return true;
      return moveToPlaceCoords.isFinished() && !isRefSolid();
    },
    onTransition: () => {
      logger.warn('BehaviorPlaceNear: move failed (timeout or ref missing)');
      targets.placedConfirmed = false;
    }
  });

  // 5. placeBlock → exit (success): block placed correctly
  const placeToExitSuccess = new StateTransition({
    name: 'PlaceNear: placeBlock → exit (success)',
    parent: placeBlock,
    child: exit,
    shouldTransition: () => {
      if (Date.now() - placeStartTime < 500) return false;
      return blockPlacedCorrectly();
    },
    onTransition: () => {
      targets.placedConfirmed = true;
      try {
        const blk = bot.blockAt(targets.placedPosition, false);
        logger.info(`BehaviorPlaceNear: Confirmed placement of ${blk?.name}`);
      } catch (_) {}
    }
  });

  // 6. placeBlock → clearArea: not placed, area obstructed, haven't cleared yet
  const placeToClear = new StateTransition({
    name: 'PlaceNear: placeBlock → clearArea',
    parent: placeBlock,
    child: clearArea,
    shouldTransition: () => {
      if (Date.now() - placeStartTime < 500) return false;
      return !blockPlacedCorrectly() && !clearedOnce && isObstructed();
    },
    onTransition: () => {
      logger.info('BehaviorPlaceNear: placement obstructed, clearing area');
      restoreStandingPosition();
      clearedOnce = true;
      clearTargets.placePosition = targets.placePosition!.clone();
      clearTargets.clearRadiusHorizontal = Number.isFinite(targets.clearRadiusHorizontal)
        ? targets.clearRadiusHorizontal : 1;
      clearTargets.clearRadiusVertical = Number.isFinite(targets.clearRadiusVertical)
        ? targets.clearRadiusVertical : 2;
    }
  });

  // 7. placeBlock → exit (failure): not placed, not obstructed (or already cleared)
  const placeToExitFail = new StateTransition({
    name: 'PlaceNear: placeBlock → exit (failure)',
    parent: placeBlock,
    child: exit,
    shouldTransition: () => {
      if (Date.now() - placeStartTime < 500) return false;
      return !blockPlacedCorrectly() && (clearedOnce || !isObstructed());
    },
    onTransition: () => {
      const placedBlock = targets.placedPosition ? bot.blockAt(targets.placedPosition, false) : null;
      const refBlock = targets.placePosition ? bot.blockAt(targets.placePosition, false) : null;
      const botDist = targets.placePosition ? bot.entity.position.distanceTo(targets.placePosition).toFixed(1) : '?';
      logger.error(`BehaviorPlaceNear: placement failed — dist=${botDist}, ref=${refBlock?.name || 'none'}, at placed pos: ${placedBlock?.name || 'air'}`);
      targets.placedConfirmed = false;
    }
  });

  // 8. clearArea → moveTo: retry after clearing
  const clearToMove = new StateTransition({
    name: 'PlaceNear: clearArea → moveTo (retry)',
    parent: clearArea,
    child: moveToPlaceCoords,
    shouldTransition: () => typeof clearArea.isFinished === 'function' ? clearArea.isFinished() : true,
    onTransition: () => {
      logger.info('BehaviorPlaceNear: clearing complete, retrying placement');
      targets.position = standingPosition;
      moveStartTime = Date.now();
    }
  });

  const transitions = [
    enterToExit,
    enterToMove,
    moveToPlace,
    moveToExit,
    placeToExitSuccess,
    placeToClear,
    placeToExitFail,
    clearToMove
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  stateMachine.onStateExited = function () {
    logger.debug('PlaceNear: cleaning up on state exit');

    if (moveToPlaceCoords && typeof moveToPlaceCoords.onStateExited === 'function') {
      try {
        moveToPlaceCoords.onStateExited();
      } catch (err: any) {
        logger.warn(`PlaceNear: error cleaning up moveToPlaceCoords: ${err.message}`);
      }
    }

    if (clearArea && typeof clearArea.onStateExited === 'function') {
      try {
        clearArea.onStateExited();
      } catch (err: any) {
        logger.warn(`PlaceNear: error cleaning up clearArea: ${err.message}`);
      }
    }

    try {
      bot.clearControlStates();
    } catch (err: any) {
      logger.debug(`PlaceNear: error clearing control states: ${err.message}`);
    }
  };

  return stateMachine;
}

export default createPlaceNearState;
