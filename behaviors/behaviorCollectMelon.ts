/**
 * BehaviorCollectMelon - Mine melon blocks for melon slices
 * 
 * Each melon block drops 3-7 melon slices (avg ~5).
 * Melon slices restore 2 hunger points each.
 */

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getInventoryObject, getItemCountInInventory } from '../utils/inventory';
import { buildStateMachineForPath } from '../behavior_generator/buildMachine';
import type { Bot } from '../behavior_generator/types';
import { plan as planner, _internals as plannerInternals } from '../planner';
import { captureAdaptiveSnapshot } from '../utils/adaptiveSnapshot';

const minecraftData = require('minecraft-data');

interface CollectMelonTargets {
  targetMelonCount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  worldSnapshot?: any;
  snapshotRadii?: number[];
  onComplete?: (success: boolean, melonCollected: number) => void;
}

type Phase = 'init' | 'planning' | 'executing' | 'complete' | 'failed';

export const MELON_SLICE_HUNGER_POINTS = 2;
const DEFAULT_RADII = [32, 64, 96, 128];

/**
 * Creates a state machine for collecting melon slices
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function createCollectMelonState(bot: Bot, targets: CollectMelonTargets): any {
  let phase: Phase = 'init';
  let startMelonCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  let currentPath: any[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  let pathStateMachine: any = null;
  
  const enter = new BehaviorIdle();
  const planning = new BehaviorIdle();
  const executing = new BehaviorIdle();
  const exit = new BehaviorIdle();
  
  addStateLogging(enter, 'CollectMelon:Enter', { logEnter: true });
  addStateLogging(planning, 'CollectMelon:Planning', { logEnter: true });
  addStateLogging(executing, 'CollectMelon:Executing', { logEnter: true });
  
  function getMelonCount(): number {
    return getItemCountInInventory(bot, 'melon_slice');
  }
  
  function getMelonCollected(): number {
    return getMelonCount() - startMelonCount;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  async function tryPlanWithSnapshot(snapshot: any): Promise<any[] | null> {
    try {
      const inventory = getInventoryObject(bot);
      const inventoryMap = new Map(Object.entries(inventory));
      const version = bot.version || '1.20.1';
      const mcData = minecraftData(version);
      
      const tree = planner(mcData, 'melon_slice', targets.targetMelonCount, {
        inventory: inventoryMap,
        log: false,
        pruneWithWorld: !!snapshot,
        combineSimilarNodes: true,
        worldSnapshot: snapshot
      });
      
      if (!tree) return null;
      
      const { enumerateActionPathsGenerator } = plannerInternals;
      const iter = enumerateActionPathsGenerator(tree, { inventory });
      
      for (const path of iter) {
        if (path && path.length > 0) {
          return path;
        }
      }
      
      return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`CollectMelon: planning error - ${err?.message || err}`);
      return null;
    }
  }
  
  async function generatePath(): Promise<void> {
    logger.info(`CollectMelon: planning to collect ${targets.targetMelonCount} melon slices`);
    
    // Try with provided snapshot first
    if (targets.worldSnapshot) {
      currentPath = await tryPlanWithSnapshot(targets.worldSnapshot);
      if (currentPath) {
        logger.info(`CollectMelon: found path with provided snapshot (${currentPath.length} steps)`);
        return;
      }
    }
    
    // Try adaptive snapshot with planner validation
    const radii = targets.snapshotRadii || DEFAULT_RADII;
    
    for (const radius of radii) {
      logger.debug(`CollectMelon: trying snapshot at radius ${radius}`);
      
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
        const result = await captureAdaptiveSnapshot(bot as any, {
          radii: [radius],
          onProgress: (msg: string) => logger.debug(`CollectMelon: ${msg}`)
        });
        
        if (result.snapshot) {
          currentPath = await tryPlanWithSnapshot(result.snapshot);
          if (currentPath) {
            logger.info(`CollectMelon: found path at radius ${radius} (${currentPath.length} steps)`);
            return;
          }
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.debug(`CollectMelon: snapshot at radius ${radius} failed - ${err?.message || err}`);
      }
    }
    
    logger.info('CollectMelon: no viable path found at any radius');
    currentPath = null;
  }
  
  // Transitions
  const enterToPlanning = new StateTransition({
    parent: enter,
    child: planning,
    name: 'CollectMelon: enter -> planning',
    shouldTransition: () => phase === 'init',
    onTransition: () => {
      startMelonCount = getMelonCount();
      phase = 'planning';
      logger.info(`CollectMelon: starting, current melon slices = ${startMelonCount}`);
    }
  });
  
  const planningToExecuting = new StateTransition({
    parent: planning,
    child: executing,
    name: 'CollectMelon: planning -> executing',
    shouldTransition: () => phase === 'executing' && currentPath !== null && pathStateMachine !== null,
    onTransition: () => {
      logger.info(`CollectMelon: executing plan with ${currentPath?.length || 0} steps`);
    }
  });
  
  const planningToExit = new StateTransition({
    parent: planning,
    child: exit,
    name: 'CollectMelon: planning -> exit (failed)',
    shouldTransition: () => phase === 'failed',
    onTransition: () => {
      logger.info('CollectMelon: failed to find a viable plan');
    }
  });
  
  const executingToExit = new StateTransition({
    parent: executing,
    child: exit,
    name: 'CollectMelon: executing -> exit',
    shouldTransition: () => {
      if (!pathStateMachine) return phase === 'complete' || phase === 'failed';
      const finished = typeof pathStateMachine.isFinished === 'function'
        ? pathStateMachine.isFinished()
        : false;
      return finished;
    },
    onTransition: () => {
      const collected = getMelonCollected();
      if (collected > 0) {
        phase = 'complete';
        logger.info(`CollectMelon: completed, collected ${collected} melon slices`);
      } else {
        phase = 'failed';
        logger.info('CollectMelon: execution completed but no melon collected');
      }
    }
  });
  
  const transitions = [
    enterToPlanning,
    planningToExecuting,
    planningToExit,
    executingToExit
  ];
  
  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  stateMachine.stateName = 'CollectMelon';
  
  // Handle planning state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const planningAsAny = planning as any;
  const originalPlanningEntered = planningAsAny.onStateEntered;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  planningAsAny.onStateEntered = async function(this: any) {
    if (originalPlanningEntered) originalPlanningEntered.call(this);
    
    await generatePath();
    
    if (currentPath && currentPath.length > 0) {
      pathStateMachine = buildStateMachineForPath(bot, currentPath, (success: boolean) => {
        const collected = getMelonCollected();
        if (success && collected > 0) {
          phase = 'complete';
        } else {
          phase = 'failed';
        }
        logger.info(`CollectMelon: path execution ${success ? 'succeeded' : 'failed'}`);
        pathStateMachine = null;
        currentPath = null;
      });
      phase = 'executing';
    } else {
      phase = 'failed';
    }
  };
  
  // Handle executing state - tick the path state machine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const executingAsAny = executing as any;
  const originalExecutingEntered = executingAsAny.onStateEntered;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  executingAsAny.onStateEntered = function(this: any) {
    if (originalExecutingEntered) originalExecutingEntered.call(this);
    if (pathStateMachine && typeof pathStateMachine.onStateEntered === 'function') {
      logger.debug('CollectMelon: starting path sub-machine');
      pathStateMachine.onStateEntered();
    }
  };
  executingAsAny.update = function() {
    if (pathStateMachine && typeof pathStateMachine.update === 'function') {
      pathStateMachine.update();
    }
  };
  
  // Completion tracking
  let reachedExit = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  (stateMachine as any).isFinished = () => reachedExit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  (stateMachine as any).wasSuccessful = () => phase === 'complete';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  (stateMachine as any).getMelonCollected = getMelonCollected;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const exitAsAny = exit as any;
  const originalExitEntered = exitAsAny.onStateEntered;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  exitAsAny.onStateEntered = function(this: any) {
    reachedExit = true;
    if (targets.onComplete) {
      targets.onComplete(phase === 'complete', getMelonCollected());
    }
    if (originalExitEntered) {
      originalExitEntered.call(this);
    }
  };
  
  // Cleanup
  stateMachine.onStateExited = function() {
    logger.debug('CollectMelon: cleaning up');
    
    if (pathStateMachine && typeof pathStateMachine.onStateExited === 'function') {
      try { pathStateMachine.onStateExited(); } catch (_) {}
    }
    
    try { bot.clearControlStates?.(); } catch (_) {}
  };
  
  return stateMachine;
}

export default createCollectMelonState;

