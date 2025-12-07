/**
 * BehaviorCollectBread - Mine hay bales and craft bread
 * 
 * Orchestrates mining hay bales for wheat, then crafting bread.
 * Each hay bale drops 9 wheat, and bread requires 3 wheat.
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
import { plan as planner, _internals as plannerInternals } from '../planner';
import { captureAdaptiveSnapshot } from '../utils/adaptiveSnapshot';

const minecraftData = require('minecraft-data');

interface Bot {
  version?: string;
  entity?: { position: any };
  inventory?: any;
  clearControlStates?: () => void;
  [key: string]: any;
}

interface CollectBreadTargets {
  targetBreadCount: number;
  worldSnapshot?: any;
  snapshotRadii?: number[];
  onComplete?: (success: boolean, breadCollected: number) => void;
}

type Phase = 'init' | 'planning' | 'executing' | 'complete' | 'failed';

const BREAD_HUNGER_POINTS = 5;
const DEFAULT_RADII = [32, 64, 96, 128];

/**
 * Creates a state machine for collecting bread from hay bales
 */
function createCollectBreadState(bot: Bot, targets: CollectBreadTargets): any {
  let phase: Phase = 'init';
  let startBreadCount = 0;
  let currentPath: any[] | null = null;
  let pathStateMachine: any = null;
  
  const enter = new BehaviorIdle();
  const planning = new BehaviorIdle();
  const executing = new BehaviorIdle();
  const exit = new BehaviorIdle();
  
  addStateLogging(enter, 'CollectBread:Enter', { logEnter: true });
  addStateLogging(planning, 'CollectBread:Planning', { logEnter: true });
  addStateLogging(executing, 'CollectBread:Executing', { logEnter: true });
  
  function getBreadCount(): number {
    return getItemCountInInventory(bot, 'bread');
  }
  
  function getBreadCollected(): number {
    return getBreadCount() - startBreadCount;
  }
  
  async function tryPlanWithSnapshot(snapshot: any): Promise<any[] | null> {
    try {
      const inventory = getInventoryObject(bot);
      const inventoryMap = new Map(Object.entries(inventory));
      const version = bot.version || '1.20.1';
      const mcData = minecraftData(version);
      
      const tree = planner(mcData, 'bread', targets.targetBreadCount, {
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
    } catch (err: any) {
      logger.debug(`CollectBread: planning error - ${err?.message || err}`);
      return null;
    }
  }
  
  async function captureSnapshotWithValidation(): Promise<any> {
    const inventory = getInventoryObject(bot);
    const inventoryMap = new Map(Object.entries(inventory));
    const version = bot.version || '1.20.1';
    const mcData = minecraftData(version);
    const radii = targets.snapshotRadii || DEFAULT_RADII;
    
    const validator = async (snapshot: any): Promise<boolean> => {
      try {
        const tree = planner(mcData, 'bread', targets.targetBreadCount, {
          inventory: new Map(inventoryMap),
          log: false,
          pruneWithWorld: true,
          combineSimilarNodes: true,
          worldSnapshot: snapshot
        });
        
        if (!tree) {
          logger.debug(`CollectBread: validator - no tree at radius ${snapshot.radius}`);
          return false;
        }
        
        const { enumerateActionPathsGenerator } = plannerInternals;
        const iter = enumerateActionPathsGenerator(tree, { inventory });
        
        for (const path of iter) {
          if (path && path.length > 0) {
            logger.debug(`CollectBread: validator - found valid path at radius ${snapshot.radius}`);
            return true;
          }
        }
        
        logger.debug(`CollectBread: validator - no paths at radius ${snapshot.radius}`);
        return false;
      } catch (err: any) {
        logger.debug(`CollectBread: validator error - ${err?.message || err}`);
        return false;
      }
    };
    
    try {
      logger.info(`CollectBread: capturing adaptive snapshot with radii ${JSON.stringify(radii)}`);
      const result = await captureAdaptiveSnapshot(bot, {
        radii,
        validator,
        onProgress: (msg: string) => logger.debug(`CollectBread: ${msg}`)
      });
      logger.info(`CollectBread: snapshot captured at radius ${result.radiusUsed} after ${result.attemptsCount} attempts`);
      return result.snapshot;
    } catch (err: any) {
      logger.info(`CollectBread: snapshot capture failed - ${err?.message || err}`);
      return null;
    }
  }
  
  async function generateBreadPlan(): Promise<any[] | null> {
    // First try with provided snapshot
    if (targets.worldSnapshot) {
      const path = await tryPlanWithSnapshot(targets.worldSnapshot);
      if (path) return path;
      logger.debug('CollectBread: provided snapshot insufficient, capturing new one');
    }
    
    // Capture our own snapshot with planner validation
    const snapshot = await captureSnapshotWithValidation();
    if (!snapshot) return null;
    
    return tryPlanWithSnapshot(snapshot);
  }
  
  // Transitions
  
  const enterToPlanning = new StateTransition({
    parent: enter,
    child: planning,
    name: 'CollectBread: enter -> planning',
    shouldTransition: () => true,
    onTransition: () => {
      phase = 'init';
      startBreadCount = getBreadCount();
      logger.info(`CollectBread: starting, current bread = ${startBreadCount}, target = ${targets.targetBreadCount}`);
    }
  });
  
  const planningToExecuting = new StateTransition({
    parent: planning,
    child: executing,
    name: 'CollectBread: planning -> executing',
    shouldTransition: () => phase === 'executing' && currentPath !== null,
    onTransition: () => {
      if (currentPath) {
        logger.info(`CollectBread: executing path with ${currentPath.length} steps`);
        pathStateMachine = buildStateMachineForPath(
          bot,
          currentPath,
          (success: boolean) => {
            if (success) {
              phase = 'complete';
            } else {
              phase = 'failed';
            }
            pathStateMachine = null;
          }
        );
      }
    }
  });
  
  const planningToExit = new StateTransition({
    parent: planning,
    child: exit,
    name: 'CollectBread: planning -> exit (failed)',
    shouldTransition: () => phase === 'failed',
    onTransition: () => {
      logger.info('CollectBread: planning failed, no viable path');
    }
  });
  
  const executingToExit = new StateTransition({
    parent: executing,
    child: exit,
    name: 'CollectBread: executing -> exit',
    shouldTransition: () => {
      if (!pathStateMachine) return phase === 'complete' || phase === 'failed';
      const finished = typeof pathStateMachine.isFinished === 'function'
        ? pathStateMachine.isFinished()
        : false;
      return finished || phase === 'complete' || phase === 'failed';
    },
    onTransition: () => {
      const collected = getBreadCollected();
      logger.info(`CollectBread: ${phase === 'complete' ? 'complete' : 'failed'}, collected ${collected} bread`);
    }
  });
  
  // Hook into executing state to start and tick the path state machine
  const executingAsAny = executing as any;
  const originalExecutingEntered = executingAsAny.onStateEntered;
  executingAsAny.onStateEntered = function(this: any) {
    if (originalExecutingEntered) originalExecutingEntered.call(this);
    if (pathStateMachine && typeof pathStateMachine.onStateEntered === 'function') {
      logger.info('CollectBread: starting path execution state machine');
      pathStateMachine.onStateEntered();
    }
  };
  
  // Tick the path state machine on each update
  executingAsAny.update = function() {
    if (pathStateMachine && typeof pathStateMachine.update === 'function') {
      pathStateMachine.update();
    }
  };
  
  const transitions = [
    enterToPlanning,
    planningToExecuting,
    planningToExit,
    executingToExit
  ];
  
  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  
  // Start planning when entering the planning state
  const planningAsAny = planning as any;
  const originalPlanningEntered = planningAsAny.onStateEntered;
  planningAsAny.onStateEntered = async function(this: any) {
    if (originalPlanningEntered) originalPlanningEntered.call(this);
    
    phase = 'planning';
    
    currentPath = await generateBreadPlan();
    
    if (currentPath && currentPath.length > 0) {
      phase = 'executing';
    } else {
      phase = 'failed';
    }
  };
  
  let reachedExit = false;
  (stateMachine as any).isFinished = () => reachedExit;
  (stateMachine as any).wasSuccessful = () => phase === 'complete';
  (stateMachine as any).getBreadCollected = getBreadCollected;
  
  const exitAsAny = exit as any;
  const originalExitEntered = exitAsAny.onStateEntered;
  exitAsAny.onStateEntered = function(this: any) {
    reachedExit = true;
    if (targets.onComplete) {
      targets.onComplete(phase === 'complete', getBreadCollected());
    }
    if (originalExitEntered) {
      originalExitEntered.call(this);
    }
  };
  
  stateMachine.onStateExited = function() {
    logger.debug('CollectBread: cleaning up');
    
    if (pathStateMachine && typeof pathStateMachine.onStateExited === 'function') {
      try { pathStateMachine.onStateExited(); } catch (_) {}
    }
    
    try { bot.clearControlStates?.(); } catch (_) {}
  };
  
  return stateMachine;
}

export default createCollectBreadState;
export { CollectBreadTargets, BREAD_HUNGER_POINTS };
