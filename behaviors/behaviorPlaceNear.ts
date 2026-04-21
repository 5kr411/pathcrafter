const Vec3 = require('vec3').Vec3;

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import createClearAreaState from './behaviorClearArea';
import { BehaviorSmartMoveTo } from './behaviorSmartMoveTo';
import { BehaviorWander } from './behaviorWander';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Block {
  name?: string;
  type: number;
  boundingBox?: string;
  position: Vec3Like;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
type Bot = any;

interface Targets {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  item?: any;
  placePosition?: Vec3Like;
  position?: Vec3Like;
  placedPosition?: Vec3Like;
  placedConfirmed?: boolean;
  blockFace?: Vec3Like;
  referenceBlock?: Block;
  clearRadiusHorizontal?: number;
  clearRadiusVertical?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function createInnerPlaceState(bot: Bot, targets: Targets): any {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.warn(`BehaviorPlaceNear: placeBlock error: ${err.message || err}`);
    }
  };

  const exit = new BehaviorIdle();

  // --- Spot selection ---
  function findSpot(): boolean {
    targets.placedConfirmed = false;
    const botPos = bot.entity.position.clone().floored();
    const candidates: { ground: Vec3Like; dist: number }[] = [];

    const fallbackCandidates: { ground: Vec3Like; dist: number }[] = [];

    for (let dy = -4; dy <= 2; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        for (let dz = -6; dz <= 6; dz++) {
          const hdist = Math.sqrt(dx * dx + dz * dz);
          if (hdist < 1 || hdist > 8) continue;
          const ground = botPos.clone().offset(dx, dy, dz);
          if (failedPositions.has(posKey(ground))) continue;
          try {
            const b = bot.blockAt(ground, false);
            if (!b || b.type === 0 || b.boundingBox !== 'block') continue;
            const above = ground.clone().offset(0, 1, 0);
            const aboveBlock = bot.blockAt(above, false);
            if (!aboveBlock) continue; // unloaded chunk — skip
            if (aboveBlock.type === 0) {
              candidates.push({ ground, dist: hdist });
            } else {
              // Fallback: solid above but diggable (clearArea can handle it)
              if (aboveBlock.diggable !== false) {
                fallbackCandidates.push({ ground, dist: hdist });
              }
            }
          } catch (_) {
            continue;
          }
        }
      }
    }

    // Use fallback candidates (solid above, needs clearing) if no air-above spots found
    if (candidates.length === 0 && fallbackCandidates.length > 0) {
      candidates.push(...fallbackCandidates);
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
  let standingPosition: Vec3Like | undefined = undefined;
  const moveTimeoutMs = 15000;

  const failedPositions = new Set<string>();

  function posKey(pos: Vec3Like): string {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  }

  function setupPlaceTransition() {
    targets.blockFace = new Vec3(0, 1, 0);
    if (targets.placePosition) {
      targets.placedPosition = targets.placePosition.clone();
      targets.placedPosition.y += 1;
    }
    placeStartTime = Date.now();
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
      if (!findSpot()) return; // will fall through to exit via fast-exit
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
      if (!targets.position) return true; // fast-exit: findSpot failed
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

  // 6. placeBlock → exit (failure): not placed
  const placeToExitFail = new StateTransition({
    name: 'PlaceNear: placeBlock → exit (failure)',
    parent: placeBlock,
    child: exit,
    shouldTransition: () => {
      if (Date.now() - placeStartTime < 500) return false;
      return !blockPlacedCorrectly();
    },
    onTransition: () => {
      if (targets.placePosition) {
        failedPositions.add(posKey(targets.placePosition));
      }
      const placedBlock = targets.placedPosition ? bot.blockAt(targets.placedPosition, false) : null;
      const refBlock = targets.placePosition ? bot.blockAt(targets.placePosition, false) : null;
      const botDist = targets.placePosition ? bot.entity.position.distanceTo(targets.placePosition).toFixed(1) : '?';
      logger.error(`BehaviorPlaceNear: placement failed — dist=${botDist}, ref=${refBlock?.name || 'none'}, at placed pos: ${placedBlock?.name || 'air'}`);
      targets.placedConfirmed = false;
    }
  });

  const transitions = [
    enterToExit,
    enterToMove,
    moveToPlace,
    moveToExit,
    placeToExitSuccess,
    placeToExitFail
  ];

  const innerSM = new NestedStateMachine(transitions, enter, exit);

  innerSM.onStateExited = function () {
    logger.debug('PlaceNear: cleaning up inner SM on state exit');

    if (moveToPlaceCoords && typeof moveToPlaceCoords.onStateExited === 'function') {
      try {
        moveToPlaceCoords.onStateExited();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.warn(`PlaceNear: error cleaning up moveToPlaceCoords: ${err.message}`);
      }
    }

    try {
      bot.clearControlStates();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`PlaceNear: error clearing control states: ${err.message}`);
    }
  };

  return innerSM;
}

const MAX_WANDER_RETRIES = 5;
const MAX_CLEAR_RETRIES = 5;
const BASE_WANDER_DISTANCE = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function createPlaceNearState(bot: Bot, targets: Targets): any {
  const outerEnter = new BehaviorIdle();
  const outerExit = new BehaviorIdle();

  let wanderAttempts = 0;
  let clearAttempts = 0;
  let phase: 'wander' | 'clear' = 'wander';

  const innerPlace = createInnerPlaceState(bot, targets);
  const microWander = new BehaviorWander(bot, BASE_WANDER_DISTANCE);

  const clearTargets: Targets = { placePosition: undefined, clearRadiusHorizontal: 1, clearRadiusVertical: 2 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const clearArea = createClearAreaState(bot, clearTargets as any);

  addStateLogging(microWander, 'MicroWander', {
    logEnter: true,
    getExtraInfo: () => `retry wander (attempt ${wanderAttempts}/${MAX_WANDER_RETRIES}, dist=${microWander.distance})`
  });

  function innerFinished(): boolean {
    return typeof innerPlace.isFinished === 'function' ? innerPlace.isFinished() : false;
  }

  function totalAttemptLabel(): string {
    if (phase === 'wander') return `wander ${wanderAttempts}/${MAX_WANDER_RETRIES}`;
    return `clear ${clearAttempts}/${MAX_CLEAR_RETRIES}`;
  }

  // outerEnter → outerExit: no item set
  const outerEnterToExit = new StateTransition({
    name: 'PlaceNear(outer): enter → exit (no item)',
    parent: outerEnter,
    child: outerExit,
    shouldTransition: () => targets.item == null,
    onTransition: () => {
      logger.error('BehaviorPlaceNear: no item set');
      targets.placedConfirmed = false;
    }
  });

  // outerEnter → innerPlace: start first attempt
  const outerEnterToPlace = new StateTransition({
    name: 'PlaceNear(outer): enter → innerPlace',
    parent: outerEnter,
    child: innerPlace,
    shouldTransition: () => true,
    onTransition: () => {
      wanderAttempts = 1;
      clearAttempts = 0;
      phase = 'wander';
      logger.info(`BehaviorPlaceNear: starting placement (${totalAttemptLabel()})`);
    }
  });

  // innerPlace → outerExit (success): placement confirmed
  const placeToOuterSuccess = new StateTransition({
    name: 'PlaceNear(outer): innerPlace → exit (success)',
    parent: innerPlace,
    child: outerExit,
    shouldTransition: () => innerFinished() && targets.placedConfirmed === true,
    onTransition: () => {
      logger.info(`BehaviorPlaceNear: placement succeeded (${totalAttemptLabel()})`);
    }
  });

  // innerPlace → microWander (failure, wander phase, retries remaining)
  const placeToWander = new StateTransition({
    name: 'PlaceNear(outer): innerPlace → microWander (retry)',
    parent: innerPlace,
    child: microWander,
    shouldTransition: () => {
      return innerFinished() && targets.placedConfirmed !== true
        && phase === 'wander' && wanderAttempts < MAX_WANDER_RETRIES;
    },
    onTransition: () => {
      microWander.distance = BASE_WANDER_DISTANCE + wanderAttempts * 2;
      logger.info(`BehaviorPlaceNear: attempt failed (${totalAttemptLabel()}), wandering ${microWander.distance} blocks`);
    }
  });

  // innerPlace → clearArea (failure, wander phase exhausted OR clear phase retries remaining)
  const placeToClear = new StateTransition({
    name: 'PlaceNear(outer): innerPlace → clearArea',
    parent: innerPlace,
    child: clearArea,
    shouldTransition: () => {
      if (!innerFinished() || targets.placedConfirmed === true) return false;
      // Enter clear phase when wander retries exhausted, or continue clear phase if retries remain
      if (phase === 'wander' && wanderAttempts >= MAX_WANDER_RETRIES) return true;
      if (phase === 'clear' && clearAttempts < MAX_CLEAR_RETRIES) return true;
      return false;
    },
    onTransition: () => {
      if (phase === 'wander') {
        phase = 'clear';
        clearAttempts = 1;
        logger.info(`BehaviorPlaceNear: wander retries exhausted, switching to clear phase`);
      } else {
        clearAttempts++;
      }
      logger.info(`BehaviorPlaceNear: clearing area (${totalAttemptLabel()})`);
      // Set up clearArea targets from current placement position
      if (targets.placePosition) {
        clearTargets.placePosition = targets.placePosition.clone();
      } else {
        // Re-scan from current position to find something to clear near
        clearTargets.placePosition = bot.entity.position.clone().floored();
      }
      clearTargets.clearRadiusHorizontal = Number.isFinite(targets.clearRadiusHorizontal)
        ? targets.clearRadiusHorizontal : 1;
      clearTargets.clearRadiusVertical = Number.isFinite(targets.clearRadiusVertical)
        ? targets.clearRadiusVertical : 2;
    }
  });

  // innerPlace → outerExit (failure, all retries exhausted)
  const placeToOuterFail = new StateTransition({
    name: 'PlaceNear(outer): innerPlace → exit (all retries exhausted)',
    parent: innerPlace,
    child: outerExit,
    shouldTransition: () => {
      return innerFinished() && targets.placedConfirmed !== true
        && phase === 'clear' && clearAttempts >= MAX_CLEAR_RETRIES;
    },
    onTransition: () => {
      logger.error(`BehaviorPlaceNear: all placement attempts exhausted (${MAX_WANDER_RETRIES} wander + ${MAX_CLEAR_RETRIES} clear)`);
      targets.placedConfirmed = false;
    }
  });

  // microWander → innerPlace: retry after wander
  const wanderToPlace = new StateTransition({
    name: 'PlaceNear(outer): microWander → innerPlace (retry)',
    parent: microWander,
    child: innerPlace,
    shouldTransition: () => microWander.isFinished === true,
    onTransition: () => {
      wanderAttempts++;
      logger.info(`BehaviorPlaceNear: retrying placement (${totalAttemptLabel()})`);
    }
  });

  // clearArea → innerPlace: retry after clearing
  const clearToPlace = new StateTransition({
    name: 'PlaceNear(outer): clearArea → innerPlace (retry)',
    parent: clearArea,
    child: innerPlace,
    shouldTransition: () => typeof clearArea.isFinished === 'function' ? clearArea.isFinished() : true,
    onTransition: () => {
      logger.info(`BehaviorPlaceNear: clearing complete, retrying placement (${totalAttemptLabel()})`);
    }
  });

  const outerTransitions = [
    outerEnterToExit,
    outerEnterToPlace,
    placeToOuterSuccess,
    placeToWander,
    placeToClear,
    placeToOuterFail,
    wanderToPlace,
    clearToPlace
  ];

  const outerSM = new NestedStateMachine(outerTransitions, outerEnter, outerExit);

  outerSM.onStateExited = function () {
    logger.debug('PlaceNear(outer): cleaning up on state exit');

    if (innerPlace && typeof innerPlace.onStateExited === 'function') {
      try {
        innerPlace.onStateExited();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.warn(`PlaceNear(outer): error cleaning up innerPlace: ${err.message}`);
      }
    }

    if (microWander && typeof microWander.onStateExited === 'function') {
      try {
        microWander.onStateExited();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.warn(`PlaceNear(outer): error cleaning up microWander: ${err.message}`);
      }
    }

    if (clearArea && typeof clearArea.onStateExited === 'function') {
      try {
        clearArea.onStateExited();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.warn(`PlaceNear(outer): error cleaning up clearArea: ${err.message}`);
      }
    }

    try {
      bot.clearControlStates();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`PlaceNear(outer): error clearing control states: ${err.message}`);
    }
  };

  return outerSM;
}

export default createPlaceNearState;
