const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

const minecraftData = require('minecraft-data');
import logger from '../utils/logger';
import { getLastSnapshotRadius } from '../utils/context';
import { getItemCountInInventory } from '../utils/inventory';
import { ExecutionContext } from '../bots/collector/execution_context';

import createCollectBlockState from './behaviorCollectBlock';
import { isPositionNearLiquid } from './behaviorSafeFindBlock';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  [key: string]: any;
}

interface Bot {
  version?: string;
  entity?: {
    position: Vec3Like;
  };
  findBlocks?: (options: { matching: any; maxDistance: number; count: number }) => Vec3Like[];
  [key: string]: any;
}

interface Candidate {
  blockName: string;
  itemName?: string;
  amount?: number;
}

interface Targets {
  candidates: Candidate[];
  amount?: number;
  executionContext?: ExecutionContext;
}

interface DynamicTargets {
  blockName: string | null;
  itemName: string | null;
  amount: number;
  executionContext?: ExecutionContext;
}

interface MinecraftData {
  blocksByName: Record<string, { id?: number }>;
}

interface EvaluationResult {
  count: number;
  nearest: number;
}

interface Selection {
  chosen: {
    blockName: string;
    itemName: string;
    amount: number;
  } | null;
}

function dist2(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function createMineAnyOfState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const prepare = new BehaviorIdle();
  const exit = new BehaviorIdle();
  const failedBlocks = new Set<string>();

  const mcData: MinecraftData | null = (() => {
    try {
      return minecraftData(bot.version);
    } catch (_) {
      return null;
    }
  })();

  const selection: Selection = { chosen: null };
  let initialInventoryCounts: Record<string, number> = {};
  let totalRequiredAmount = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 10;

  function getTrackedItemNames(): string[] {
    const list = Array.isArray(targets && targets.candidates) ? targets.candidates : [];
    return Array.from(new Set(list.map((c) => c?.itemName).filter(Boolean) as string[]));
  }

  function getTotalCollected(): number {
    const itemNames = getTrackedItemNames();
    if (itemNames.length === 0) return 0;

    // If all candidates produce the same item, measure only that item to avoid double-counting
    if (itemNames.length === 1) {
      const name = itemNames[0];
      const current = getItemCountInInventory(bot, name);
      const initial = initialInventoryCounts[name] || 0;
      return Math.max(0, current - initial);
    }

    // Mixed outputs: sum deltas across unique item names
    let total = 0;
    for (const name of itemNames) {
      const current = getItemCountInInventory(bot, name);
      const initial = initialInventoryCounts[name] || 0;
      total += Math.max(0, current - initial);
    }
    return total;
  }

  function getCollectionBreakdown(): string {
    const itemNames = getTrackedItemNames();
    const breakdown: string[] = [];
    for (const name of itemNames) {
      const current = getItemCountInInventory(bot, name);
      const initial = initialInventoryCounts[name] || 0;
      const collected = Math.max(0, current - initial);
      if (collected > 0) {
        breakdown.push(`${name}:${collected}`);
      }
    }
    return breakdown.length > 0 ? breakdown.join(', ') : 'none';
  }

  async function evaluateCandidateAsync(blockName: string, required: number): Promise<EvaluationResult> {
    try {
      const botAny = bot as any;
      if (!bot || (typeof bot.findBlocks !== 'function' && typeof botAny.findBlocksAsync !== 'function'))
        return { count: 0, nearest: Number.POSITIVE_INFINITY };
      const radius = (() => {
        try {
          const r = Number(getLastSnapshotRadius && getLastSnapshotRadius());
          if (Number.isFinite(r) && r > 0) return r;
        } catch (_) {}
        return 64;
      })();
      const maxCount = Math.max(required || 1, 32);
      const id =
        mcData && mcData.blocksByName && mcData.blocksByName[blockName]
          ? mcData.blocksByName[blockName].id
          : null;
      const matcher = id != null ? id : (b: any) => b && b.name === blockName;
      
      let allPositions: Vec3Like[] = [];
      if (typeof botAny.findBlocksAsync === 'function') {
        allPositions = await botAny.findBlocksAsync({ matching: matcher, maxDistance: radius, count: maxCount, yieldEvery: 16 }) || [];
      } else {
        allPositions = bot.findBlocks!({ matching: matcher, maxDistance: radius, count: maxCount }) || [];
      }
      
      const positions = allPositions.filter((p) => !isPositionNearLiquid(bot, p));
      let near = Number.POSITIVE_INFINITY;
      const center = bot.entity && bot.entity.position ? bot.entity.position : { x: 0, y: 0, z: 0 };
      for (const p of positions) {
        const d2 = dist2(center, p);
        if (d2 < near) near = d2;
      }
      return { count: positions.length, nearest: near };
    } catch (_) {
      return { count: 0, nearest: Number.POSITIVE_INFINITY };
    }
  }

  const dynamicTargets: DynamicTargets = {
    blockName: null,
    itemName: null,
    amount: 0,
    executionContext: targets.executionContext
  };
  let collectBehavior: any = null;
  try {
    collectBehavior = createCollectBlockState(bot, dynamicTargets as any);
  } catch (_) {
    collectBehavior = null;
  }

  let selectionInProgress = false;
  let selectionComplete = false;

  function startSelection(): void {
    if (selectionInProgress) return;
    selectionInProgress = true;
    selectionComplete = false;
    selection.chosen = null;
    
    selectBestCandidateAsync().then(chosen => {
      if (chosen) selection.chosen = chosen;
      selectionComplete = true;
      selectionInProgress = false;
    }).catch(() => {
      selectionComplete = true;
      selectionInProgress = false;
    });
  }

  async function selectBestCandidateAsync(): Promise<{ blockName: string; itemName: string; amount: number } | null> {
    const list = Array.isArray(targets && targets.candidates) ? targets.candidates : [];
    if (list.length === 0) return null;

    let best: any = null;
    let bestNear = Number.POSITIVE_INFINITY;

    for (const c of list) {
      if (!c || !c.blockName) continue;
      if (failedBlocks.has(c.blockName)) continue;
      const evalRes = await evaluateCandidateAsync(c.blockName, 1);
      if (evalRes.count > 0 && evalRes.nearest < bestNear) {
        bestNear = evalRes.nearest;
        best = { ...c, eval: evalRes };
      }
    }

    if (!best) return null;

    const itemName = best.itemName || best.blockName;
    const amount = 1;
    selection.chosen = { blockName: best.blockName, itemName, amount };
    return selection.chosen;
  }

  if (!collectBehavior) {
    const noop = new BehaviorIdle();
    const t0 = new StateTransition({
      parent: enter,
      child: noop,
      name: 'mine-any-of: enter -> noop',
      shouldTransition: () => true
    });
    const t0b = new StateTransition({
      parent: noop,
      child: exit,
      name: 'mine-any-of: noop -> exit',
      shouldTransition: () => true
    });
    return new NestedStateMachine([t0, t0b], enter, exit);
  }

  const tEnterToPrepare = new StateTransition({
    parent: enter,
    child: prepare,
    name: 'mine-any-of: enter -> prepare',
    shouldTransition: () => true,
    onTransition: () => {
      initialInventoryCounts = {};
      totalRequiredAmount = Number(targets.amount || 1);
      consecutiveFailures = 0;
      failedBlocks.clear();
      selectionComplete = false;
      selectionInProgress = false;
      const itemNames = getTrackedItemNames();
      for (const name of itemNames) {
        initialInventoryCounts[name] = getItemCountInInventory(bot, name);
      }
      try {
        logger.debug('preparing selection...');
      } catch (_) {}
      // Start async selection
      startSelection();
    }
  });

  const tPrepareToCollect = new StateTransition({
    parent: prepare,
    child: collectBehavior,
    name: 'mine-any-of: prepare -> collect',
    shouldTransition: () => {
      if (!selectionComplete) return false;
      if (!selection.chosen) return false;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        try {
          logger.error(`BehaviorMineAnyOf: giving up after ${consecutiveFailures} consecutive failures`);
        } catch (_) {}
        return false;
      }
      return true;
    },
    onTransition: () => {
      if (selection.chosen) {
        dynamicTargets.blockName = selection.chosen.blockName;
        dynamicTargets.itemName = selection.chosen.itemName;
        dynamicTargets.amount = selection.chosen.amount;
        
        if (typeof (collectBehavior as any).resetBaseline === 'function') {
          (collectBehavior as any).resetBaseline();
        }
        
        const total = getTotalCollected();
        const breakdown = getCollectionBreakdown();
        try {
          logger.info(
            `MineAnyOf: mining ${dynamicTargets.blockName} (overall progress: ${total}/${totalRequiredAmount}, breakdown: ${breakdown})`
          );
        } catch (_) {}
      }
    }
  });

  const tPrepareToExit = new StateTransition({
    parent: prepare,
    child: exit,
    name: 'mine-any-of: prepare -> exit (no selection or done)',
    shouldTransition: () => {
      const goalReached = getTotalCollected() >= totalRequiredAmount;
      if (goalReached) return true;
      if (!selectionComplete) return false;
      const noSelection = !selection || !selection.chosen;
      const tooManyFailures = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
      return noSelection || tooManyFailures;
    },
    onTransition: () => {
      const collected = getTotalCollected();
      const breakdown = getCollectionBreakdown();
      if (collected >= totalRequiredAmount) {
        try {
          logger.info(`BehaviorMineAnyOf: goal reached! ${collected}/${totalRequiredAmount} (${breakdown})`);
        } catch (_) {}
      } else if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        try {
          logger.error(`BehaviorMineAnyOf: giving up after ${consecutiveFailures} consecutive failures; collected ${collected}/${totalRequiredAmount} (${breakdown})`);
        } catch (_) {}
      } else {
        try {
          logger.error(`BehaviorMineAnyOf: no viable candidates found; collected ${collected}/${totalRequiredAmount} (${breakdown})`);
        } catch (_) {}
      }
    }
  });

  const tCollectToPrepare = new StateTransition({
    parent: collectBehavior,
    child: prepare,
    name: 'mine-any-of: collect -> prepare (re-evaluate)',
    shouldTransition: () => {
      const isFinished = typeof collectBehavior.isFinished === 'function' ? collectBehavior.isFinished() : true;
      return isFinished && getTotalCollected() < totalRequiredAmount;
    },
    onTransition: () => {
      const total = getTotalCollected();
      const breakdown = getCollectionBreakdown();
      
      const collectedCount = typeof (collectBehavior as any).collectedCount === 'function' 
        ? (collectBehavior as any).collectedCount() 
        : 0;
      const failureReason = typeof (collectBehavior as any).getLastFailureReason === 'function'
        ? (collectBehavior as any).getLastFailureReason()
        : null;
      if (failureReason === 'not_found' && selection?.chosen?.blockName) {
        failedBlocks.add(selection.chosen.blockName);
        try {
          logger.warn(`MineAnyOf: excluding ${selection.chosen.blockName} after find failure`);
        } catch (_) {}
      }
      
      if (collectedCount > 0) {
        consecutiveFailures = 0;
        try {
          logger.info(`MineAnyOf: overall progress ${total}/${totalRequiredAmount} (${breakdown}), re-evaluating for next block...`);
        } catch (_) {}
      } else {
        consecutiveFailures++;
        try {
          logger.warn(`MineAnyOf: overall progress ${total}/${totalRequiredAmount} (${breakdown}), failed to collect (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), re-evaluating...`);
        } catch (_) {}
      }
      
      selectionComplete = false;
      selectionInProgress = false;
      // Start async selection
      startSelection();
    }
  });

  const tCollectToExit = new StateTransition({
    parent: collectBehavior,
    child: exit,
    name: 'mine-any-of: collect -> exit (done)',
    shouldTransition: () => {
      const isFinished = typeof collectBehavior.isFinished === 'function' ? collectBehavior.isFinished() : true;
      return isFinished && getTotalCollected() >= totalRequiredAmount;
    },
    onTransition: () => {
      const total = getTotalCollected();
      const breakdown = getCollectionBreakdown();
      try {
        logger.info(`BehaviorMineAnyOf: goal reached! ${total}/${totalRequiredAmount} (${breakdown})`);
      } catch (_) {}
    }
  });

  const stateMachine = new NestedStateMachine([tEnterToPrepare, tPrepareToCollect, tPrepareToExit, tCollectToPrepare, tCollectToExit], enter, exit);
  
  stateMachine.onStateExited = function() {
    logger.debug('MineAnyOf: cleaning up on state exit');
    
    if (collectBehavior && typeof collectBehavior.onStateExited === 'function') {
      try {
        collectBehavior.onStateExited();
        logger.debug('MineAnyOf: cleaned up collectBehavior');
      } catch (err: any) {
        logger.warn(`MineAnyOf: error cleaning up collectBehavior: ${err.message}`);
      }
    }
    
    try {
      bot.clearControlStates();
      logger.debug('MineAnyOf: cleared bot control states');
    } catch (err: any) {
      logger.debug(`MineAnyOf: error clearing control states: ${err.message}`);
    }
  };
  
  return stateMachine;
}

export default createMineAnyOfState;
