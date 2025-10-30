const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

const minecraftData = require('minecraft-data');
import logger from '../utils/logger';
import { getLastSnapshotRadius, setCurrentSpeciesContext } from '../utils/context';
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

function createMineOneOfState(bot: Bot, targets: Targets): any {
  // targets: { candidates: [{ blockName, itemName, amount }], amount? }
  const enter = new BehaviorIdle();
  const prepare = new BehaviorIdle();
  const exit = new BehaviorIdle();

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

  function getTotalCollected(): number {
    let total = 0;
    const list = Array.isArray(targets && targets.candidates) ? targets.candidates : [];
    for (const c of list) {
      if (!c || !c.itemName) continue;
      const current = getItemCountInInventory(bot, c.itemName);
      const initial = initialInventoryCounts[c.itemName] || 0;
      total += Math.max(0, current - initial);
    }
    return total;
  }

  function evaluateCandidate(blockName: string, required: number): EvaluationResult {
    try {
      if (!bot || typeof bot.findBlocks !== 'function')
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
      const allPositions = bot.findBlocks({ matching: matcher, maxDistance: radius, count: maxCount }) || [];
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

  // Prepare a dynamic collect behavior whose targets we mutate at runtime
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

  const triedCandidates = new Set<string>();

  function selectBestCandidate(): { blockName: string; itemName: string; amount: number } | null {
    const list = Array.isArray(targets && targets.candidates) ? targets.candidates : [];
    if (list.length === 0) return null;
    
    // Calculate how much we still need (for one_of, this should always be the full original amount or 0)
    const totalCollected = getTotalCollected();
    const stillNeeded = Math.max(0, totalRequiredAmount - totalCollected);
    
    // If we've already collected enough, no need to select
    if (stillNeeded === 0) return null;

    let best: any = null;
    let bestNear = Number.POSITIVE_INFINITY;

    // Only consider candidates that have ENOUGH supply for the FULL amount and haven't been tried yet
    for (const c of list) {
      if (!c || !c.blockName) continue;
      
      // Skip candidates we've already tried
      if (triedCandidates.has(c.blockName)) continue;
      
      const evalRes = evaluateCandidate(c.blockName, stillNeeded);
      if (evalRes.count >= stillNeeded) {
        if (evalRes.nearest < bestNear) {
          bestNear = evalRes.nearest;
          best = { ...c, eval: evalRes };
        } else if (evalRes.nearest === bestNear && best) {
          // tie-breaker: higher count available
          if ((evalRes.count || 0) > ((best.eval && best.eval.count) || 0)) {
            best = { ...c, eval: evalRes };
          }
        }
      }
    }

    // If we found a viable candidate, mark it as tried
    if (best && best.blockName) {
      triedCandidates.add(best.blockName);
    }

    if (!best) return null;

    // Set wood species context if applicable (e.g., oak_log -> oak)
    try {
      const n = String(best.blockName || '');
      if (n.endsWith('_log')) {
        const idx = n.lastIndexOf('_');
        if (idx > 0) {
          const species = n.slice(0, idx);
          setCurrentSpeciesContext(species);
        }
      }
    } catch (_) {}

    // Normalize target item name: default to blockName when missing
    const itemName = best.itemName || best.blockName;
    // Request the full amount still needed
    const amount = stillNeeded;
    selection.chosen = { blockName: best.blockName, itemName, amount };
    return selection.chosen;
  }

  // In simple environments (tests), if we could not construct collect behavior, return a trivial behavior
  if (!collectBehavior) {
    const noop = new BehaviorIdle();
    const t0 = new StateTransition({
      parent: enter,
      child: noop,
      name: 'mine-one-of: enter -> noop',
      shouldTransition: () => true
    });
    const t0b = new StateTransition({
      parent: noop,
      child: exit,
      name: 'mine-one-of: noop -> exit',
      shouldTransition: () => true
    });
    return new NestedStateMachine([t0, t0b], enter, exit);
  }

  const tEnterToPrepare = new StateTransition({
    parent: enter,
    child: prepare,
    name: 'mine-one-of: enter -> prepare',
    shouldTransition: () => true,
    onTransition: () => {
      // Initialize tracking
      initialInventoryCounts = {};
      totalRequiredAmount = Number(targets.amount || 1);
      triedCandidates.clear();
      const list = Array.isArray(targets && targets.candidates) ? targets.candidates : [];
      for (const c of list) {
        if (!c || !c.itemName) continue;
        initialInventoryCounts[c.itemName] = getItemCountInInventory(bot, c.itemName);
      }
      try {
        logger.debug('preparing selection...');
      } catch (_) {}
      // Compute selection now based on current targets
      selection.chosen = null;
      const chosen = selectBestCandidate();
      if (chosen) selection.chosen = chosen;
    }
  });

  const tPrepareToCollect = new StateTransition({
    parent: prepare,
    child: collectBehavior,
    name: 'mine-one-of: prepare -> collect',
    shouldTransition: () => !!selection.chosen,
    onTransition: () => {
      // Fill dynamic targets just-in-time prior to collect state run
      if (selection.chosen) {
        dynamicTargets.blockName = selection.chosen.blockName;
        dynamicTargets.itemName = selection.chosen.itemName;
        dynamicTargets.amount = selection.chosen.amount;
        try {
          logger.info(
            `selected ${dynamicTargets.blockName} for ${dynamicTargets.itemName} x${dynamicTargets.amount}`
          );
        } catch (_) {}
      }
    }
  });

  const tPrepareToExit = new StateTransition({
    parent: prepare,
    child: exit,
    name: 'mine-one-of: prepare -> exit (no selection or done)',
    shouldTransition: () => {
      if (getTotalCollected() >= totalRequiredAmount) return true;
      return !selection || !selection.chosen;
    },
    onTransition: () => {
      const collected = getTotalCollected();
      if (collected >= totalRequiredAmount) {
        try {
          logger.info(`BehaviorMineOneOf: goal reached! ${collected}/${totalRequiredAmount}`);
        } catch (_) {}
      } else {
        try {
          logger.error(`BehaviorMineOneOf: no viable candidate found; collected ${collected}/${totalRequiredAmount}`);
        } catch (_) {}
      }
    }
  });

  const tCollectToPrepare = new StateTransition({
    parent: collectBehavior,
    child: prepare,
    name: 'mine-one-of: collect -> prepare (re-evaluate)',
    shouldTransition: () => {
      const isFinished = typeof collectBehavior.isFinished === 'function' ? collectBehavior.isFinished() : true;
      return isFinished && getTotalCollected() < totalRequiredAmount;
    },
    onTransition: () => {
      const total = getTotalCollected();
      try {
        logger.info(`BehaviorMineOneOf: progress ${total}/${totalRequiredAmount}, finding next block...`);
      } catch (_) {}
      selection.chosen = null;
      const chosen = selectBestCandidate();
      if (chosen) selection.chosen = chosen;
    }
  });

  const tCollectToExit = new StateTransition({
    parent: collectBehavior,
    child: exit,
    name: 'mine-one-of: collect -> exit (done)',
    shouldTransition: () => {
      const isFinished = typeof collectBehavior.isFinished === 'function' ? collectBehavior.isFinished() : true;
      return isFinished && getTotalCollected() >= totalRequiredAmount;
    },
    onTransition: () => {
      const total = getTotalCollected();
      try {
        logger.info(`BehaviorMineOneOf: goal reached! ${total}/${totalRequiredAmount}`);
      } catch (_) {}
    }
  });

  const stateMachine = new NestedStateMachine([tEnterToPrepare, tPrepareToCollect, tPrepareToExit, tCollectToPrepare, tCollectToExit], enter, exit);
  
  stateMachine.onStateExited = function() {
    logger.debug('MineOneOf: cleaning up on state exit');
    
    if (collectBehavior && typeof collectBehavior.onStateExited === 'function') {
      try {
        collectBehavior.onStateExited();
        logger.debug('MineOneOf: cleaned up collectBehavior');
      } catch (err: any) {
        logger.warn(`MineOneOf: error cleaning up collectBehavior: ${err.message}`);
      }
    }
    
    try {
      bot.clearControlStates();
      logger.debug('MineOneOf: cleared bot control states');
    } catch (err: any) {
      logger.debug(`MineOneOf: error clearing control states: ${err.message}`);
    }
  };
  
  return stateMachine;
}

export default createMineOneOfState;

