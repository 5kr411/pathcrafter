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
  [key: string]: any;
}

interface Block {
  position: Vec3Like;
  [key: string]: any;
}

type Bot = any;

interface Targets {
  placePosition?: Vec3Like;
  clearRadiusHorizontal?: number;
  clearRadiusVertical?: number;
  [key: string]: any;
}

interface BreakTargets {
  position: Vec3Like | null;
}

function createClearAreaState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const init = new BehaviorIdle();
  const awaitConfirm = new BehaviorIdle();
  const breakTargets: BreakTargets = { position: null };
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
    for (let dy = 0; dy < v; dy++) {
      for (let dx = -h; dx <= h; dx++)
        for (let dz = -h; dz <= h; dz++) list.push(head.clone().offset(dx, dy, dz));
    }
    return list;
  }

  function isAreaClear(): boolean {
    return gatherObstructions().every((p) => bot.world.getBlockType(p) === 0);
  }

  function sortedObstructions(): Vec3Like[] {
    const positions = gatherObstructions().filter((p) => bot.world.getBlockType(p) !== 0);
    positions.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    try {
      const blocks = positions.map((p) => bot.blockAt(p, false)).filter(Boolean) as Block[];
      // Prefer blocks that are both visible and diggable with current tools
      const preferred = blocks.filter((b) => {
        const vis = typeof bot.canSeeBlock === 'function' ? bot.canSeeBlock(b) : true;
        const dig = typeof bot.canDigBlock === 'function' ? bot.canDigBlock(b) : true;
        return vis && dig;
      });
      if (preferred.length > 0) return preferred.map((b) => b.position);
      // Fallback: any diggable
      const diggable = blocks.filter((b) =>
        typeof bot.canDigBlock === 'function' ? bot.canDigBlock(b) : true
      );
      if (diggable.length > 0) return diggable.map((b) => b.position);
      // Log why we can't clear
      if (blocks.length > 0) {
        const sampleBlock = blocks[0];
        const blockName = sampleBlock.name || `type${bot.world.getBlockType(sampleBlock.position)}`;
        logger.warn(`ClearArea: ${blocks.length} obstructions are not diggable (e.g., ${blockName})`);
      }
    } catch (_) {}
    // If none are diggable, return empty to avoid futile attempts
    return [];
  }

  let queue: Vec3Like[] = [];
  let idx = 0;
  let current: Vec3Like | null = null;
  let startTime = 0;
  let plannedTargetsCount = 0;
  let mineOps = 0;
  let maxMineOps = 0;
  let consecutiveFailures = 0;
  let overallStartTime = 0;
  let overallTimeoutMs = 0; // Calculated dynamically based on blocks to clear
  const MAX_CONSECUTIVE_FAILURES = 3; // Give up after 3 blocks fail to break
  const PER_BLOCK_TIMEOUT_MS = 5000; // 5 seconds per individual block attempt
  const TIMEOUT_PER_PLANNED_BLOCK_MS = 10000; // 10 seconds per block in the plan
  const MIN_OVERALL_TIMEOUT_MS = 15000; // Minimum 15 seconds even for small clears

  const enterToExit = new StateTransition({
    name: 'ClearArea: enter -> exit (no placePosition)',
    parent: enter,
    child: exit,
    shouldTransition: () => !getPlacePosition(),
    onTransition: () => {}
  });

  const enterToInit = new StateTransition({
    name: 'ClearArea: enter -> init',
    parent: enter,
    child: init,
    shouldTransition: () => !!getPlacePosition(),
    onTransition: () => {
      const initial = gatherObstructions().filter((p) => bot.world.getBlockType(p) !== 0);
      plannedTargetsCount = initial.length;
      maxMineOps = Math.max(1, Math.ceil(plannedTargetsCount * 1.5));
      mineOps = 0;
      consecutiveFailures = 0;
      overallStartTime = Date.now();
      
      // Calculate timeout: 10s per block, minimum 15s
      overallTimeoutMs = Math.max(MIN_OVERALL_TIMEOUT_MS, plannedTargetsCount * TIMEOUT_PER_PLANNED_BLOCK_MS);
      
      queue = sortedObstructions().slice(0, 48);
      idx = 0;
      if (plannedTargetsCount > 0) {
        logger.info(`ClearArea: need to clear ${plannedTargetsCount} obstructions (maxOps=${maxMineOps}, timeout=${(overallTimeoutMs/1000).toFixed(0)}s)`);
      }
    }
  });

  const initToExit = new StateTransition({
    name: 'ClearArea: init -> exit (clear or cap)',
    parent: init,
    child: exit,
    shouldTransition: () => {
      if (isAreaClear()) {
        logger.info('ClearArea: area is clear');
        return true;
      }
      if (queue.length === 0) {
        logger.warn('ClearArea: no diggable obstructions remaining');
        return true;
      }
      if (mineOps >= maxMineOps) {
        logger.warn(`ClearArea: hit operation cap (${mineOps}/${maxMineOps})`);
        return true;
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error(`ClearArea: ${consecutiveFailures} consecutive blocks failed to break, giving up`);
        return true;
      }
      const elapsed = Date.now() - overallStartTime;
      if (elapsed > overallTimeoutMs) {
        logger.error(`ClearArea: overall timeout after ${(elapsed/1000).toFixed(1)}s (limit was ${(overallTimeoutMs/1000).toFixed(0)}s)`);
        return true;
      }
      return false;
    },
    onTransition: () => {}
  });

  const initToBreak = new StateTransition({
    name: 'ClearArea: init -> break',
    parent: init,
    child: breaker,
    shouldTransition: () => {
      const elapsed = Date.now() - overallStartTime;
      return idx < queue.length && mineOps < maxMineOps && elapsed < overallTimeoutMs && consecutiveFailures < MAX_CONSECUTIVE_FAILURES;
    },
    onTransition: () => {
      while (idx < queue.length && bot.world.getBlockType(queue[idx]) === 0) idx++;
      if (idx < queue.length) {
        current = queue[idx];
        breakTargets.position = current;
        startTime = Date.now();
        mineOps++;
        const blockType = bot.world.getBlockType(current);
        let blockName = 'unknown';
        try {
          const block = bot.blockAt(current, false);
          blockName = block?.name || `type${blockType}`;
        } catch (_) {}
        logger.debug(`ClearArea: breaking obstruction ${mineOps}/${maxMineOps} at (${current.x},${current.y},${current.z}) [${blockName}]`);
      }
    }
  });

  const breakToAwait = new StateTransition({
    name: 'ClearArea: break -> await',
    parent: breaker,
    child: awaitConfirm,
    shouldTransition: () => (typeof breaker.isFinished === 'function' ? breaker.isFinished() : true),
    onTransition: () => {}
  });

  const awaitToInit = new StateTransition({
    name: 'ClearArea: await -> init',
    parent: awaitConfirm,
    child: init,
    shouldTransition: () => {
      const removed = current && bot.world.getBlockType(current) === 0;
      const elapsed = Date.now() - startTime;
      const timedOut = elapsed > PER_BLOCK_TIMEOUT_MS;
      const overallElapsed = Date.now() - overallStartTime;
      return (removed || timedOut) && 
             mineOps < maxMineOps && 
             !isAreaClear() && 
             overallElapsed < overallTimeoutMs &&
             consecutiveFailures < MAX_CONSECUTIVE_FAILURES;
    },
    onTransition: () => {
      const removed = current && bot.world.getBlockType(current) === 0;
      const elapsed = Date.now() - startTime;
      
      if (removed) {
        consecutiveFailures = 0;
        logger.debug(`ClearArea: block removed successfully (took ${elapsed}ms)`);
      } else {
        consecutiveFailures++;
        logger.warn(`ClearArea: block failed to break after ${elapsed}ms (consecutive failures: ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      }
      
      idx++;
      current = null;
      if (idx >= queue.length && !isAreaClear()) {
        queue = sortedObstructions().slice(0, 48);
        idx = 0;
        if (queue.length === 0) {
          logger.warn('ClearArea: no more diggable obstructions, but area not clear');
        }
      }
    }
  });

  const awaitToExit = new StateTransition({
    name: 'ClearArea: await -> exit (clear or cap)',
    parent: awaitConfirm,
    child: exit,
    shouldTransition: () => {
      if (isAreaClear()) return true;
      if (mineOps >= maxMineOps) return true;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return true;
      const overallElapsed = Date.now() - overallStartTime;
      if (overallElapsed > overallTimeoutMs) return true;
      return false;
    },
    onTransition: () => {}
  });

  const transitions = [enterToExit, enterToInit, initToExit, initToBreak, breakToAwait, awaitToInit, awaitToExit];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createClearAreaState;

