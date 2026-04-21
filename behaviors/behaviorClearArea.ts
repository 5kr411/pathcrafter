const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import createBreakAtPositionState from './behaviorBreakAtPosition';
import logger from '../utils/logger';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  offset: (x: number, y: number, z: number) => Vec3Like;
  clone: () => Vec3Like;
  distanceTo: (other: Vec3Like) => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
type Bot = any;

interface Targets {
  placePosition?: Vec3Like;
  clearRadiusHorizontal?: number;
  clearRadiusVertical?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface BreakTargets {
  position: Vec3Like | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function createClearAreaState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const init = new BehaviorIdle();
  const breakTargets: BreakTargets = { position: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const breaker = createBreakAtPositionState(bot, breakTargets as any);
  const exit = new BehaviorIdle();

  function getPlacePosition(): Vec3Like | null {
    return targets.placePosition && targets.placePosition.clone ? targets.placePosition.clone() : null;
  }

  function gatherObstructions(): Vec3Like[] {
    const base = getPlacePosition();
    if (!base) return [];
    const h = Number.isFinite(targets.clearRadiusHorizontal)
      ? Math.max(0, Math.floor(targets.clearRadiusHorizontal!))
      : 1;
    const v = Number.isFinite(targets.clearRadiusVertical)
      ? Math.max(1, Math.floor(targets.clearRadiusVertical!))
      : 2;
    const head = base.offset(0, 1, 0);
    const list: Vec3Like[] = [];
    for (let dy = 0; dy < v; dy++)
      for (let dx = -h; dx <= h; dx++)
        for (let dz = -h; dz <= h; dz++) list.push(head.clone().offset(dx, dy, dz));
    return list;
  }

  function isAreaClear(): boolean {
    return gatherObstructions().every((p) => bot.world.getBlockType(p) === 0);
  }

  let queue: Vec3Like[] = [];
  let idx = 0;
  let mineOps = 0;
  const MAX_OPS = 8;

  const enterToExit = new StateTransition({
    name: 'ClearArea: enter → exit (no placePosition)',
    parent: enter,
    child: exit,
    shouldTransition: () => !getPlacePosition(),
    onTransition: () => {}
  });

  const enterToInit = new StateTransition({
    name: 'ClearArea: enter → init',
    parent: enter,
    child: init,
    shouldTransition: () => !!getPlacePosition(),
    onTransition: () => {
      const nonAir = gatherObstructions().filter((p) => bot.world.getBlockType(p) !== 0);
      queue = nonAir.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
      queue = queue.slice(0, MAX_OPS);
      idx = 0;
      mineOps = 0;
      if (queue.length > 0) {
        logger.info(`ClearArea: need to clear ${queue.length} obstructions`);
      }
    }
  });

  const initToExit = new StateTransition({
    name: 'ClearArea: init → exit',
    parent: init,
    child: exit,
    shouldTransition: () => isAreaClear() || idx >= queue.length || mineOps >= MAX_OPS,
    onTransition: () => {
      if (isAreaClear()) logger.info('ClearArea: area is clear');
      else logger.warn(`ClearArea: exiting after ${mineOps} ops`);
    }
  });

  const initToBreak = new StateTransition({
    name: 'ClearArea: init → break',
    parent: init,
    child: breaker,
    shouldTransition: () => idx < queue.length && mineOps < MAX_OPS,
    onTransition: () => {
      // Skip blocks already cleared
      while (idx < queue.length && bot.world.getBlockType(queue[idx]) === 0) idx++;
      if (idx < queue.length) {
        breakTargets.position = queue[idx];
        mineOps++;
        logger.debug(`ClearArea: breaking ${mineOps}/${MAX_OPS} at (${queue[idx].x},${queue[idx].y},${queue[idx].z})`);
      }
    }
  });

  const breakToInit = new StateTransition({
    name: 'ClearArea: break → init',
    parent: breaker,
    child: init,
    shouldTransition: () => typeof breaker.isFinished === 'function' ? breaker.isFinished() : true,
    onTransition: () => {
      idx++;
    }
  });

  const transitions = [enterToExit, enterToInit, initToExit, initToBreak, breakToInit];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  stateMachine.onStateExited = function () {
    logger.debug('ClearArea: cleaning up on state exit');
    if (breaker && typeof breaker.onStateExited === 'function') {
      try {
        breaker.onStateExited();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.warn(`ClearArea: error cleaning up breaker: ${err.message}`);
      }
    }
    try {
      bot.clearControlStates();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`ClearArea: error clearing control states: ${err.message}`);
    }
  };

  return stateMachine;
}

export default createClearAreaState;
