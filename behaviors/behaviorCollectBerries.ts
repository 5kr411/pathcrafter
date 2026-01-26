/**
 * BehaviorCollectBerries - Collect sweet or glow berries using the planner
 *
 * Sweet berries and glow berries each restore 2 hunger points.
 */

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getInventoryObject, getItemCountInInventory } from '../utils/inventory';
import { hasEqualOrBetterTool } from '../utils/items';
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

interface CollectBerriesTargets {
  targetBerryCount: number;
  worldSnapshot?: any;
  snapshotRadii?: number[];
  requireIronForGlow?: boolean;
  onComplete?: (success: boolean, collected: number, itemName: string | null) => void;
}

type Phase = 'init' | 'planning' | 'executing' | 'complete' | 'failed';

export const BERRY_HUNGER_POINTS = 2;
const DEFAULT_RADII = [32, 64, 96, 128];
const SWEET_BERRIES = 'sweet_berries';
const GLOW_BERRIES = 'glow_berries';

function hasIronPickaxeOrBetter(bot: Bot): boolean {
  const inventory = getInventoryObject(bot);
  const inventoryMap = new Map(Object.entries(inventory));
  return hasEqualOrBetterTool(inventoryMap, 'iron_pickaxe');
}

/**
 * Creates a state machine for collecting berries
 */
function createCollectBerriesState(bot: Bot, targets: CollectBerriesTargets): any {
  let phase: Phase = 'init';
  let currentPath: any[] | null = null;
  let pathStateMachine: any = null;
  let selectedItem: string | null = null;
  let startCounts: Record<string, number> = {};

  const enter = new BehaviorIdle();
  const planning = new BehaviorIdle();
  const executing = new BehaviorIdle();
  const exit = new BehaviorIdle();

  addStateLogging(enter, 'CollectBerries:Enter', { logEnter: true });
  addStateLogging(planning, 'CollectBerries:Planning', { logEnter: true });
  addStateLogging(executing, 'CollectBerries:Executing', { logEnter: true });

  function getCollected(itemName: string | null): number {
    if (!itemName) return 0;
    const current = getItemCountInInventory(bot, itemName);
    const initial = startCounts[itemName] || 0;
    return current - initial;
  }

  async function tryPlanWithSnapshot(snapshot: any, itemName: string): Promise<any[] | null> {
    try {
      const inventory = getInventoryObject(bot);
      const inventoryMap = new Map(Object.entries(inventory));
      const version = bot.version || '1.20.1';
      const mcData = minecraftData(version);

      const tree = planner(mcData, itemName, targets.targetBerryCount, {
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
      logger.debug(`CollectBerries: planning error - ${err?.message || err}`);
      return null;
    }
  }

  function getCandidates(): string[] {
    const requireIron = targets.requireIronForGlow ?? true;
    if (requireIron && !hasIronPickaxeOrBetter(bot)) {
      return [SWEET_BERRIES];
    }
    return [SWEET_BERRIES, GLOW_BERRIES];
  }

  async function generatePath(): Promise<void> {
    logger.info(`CollectBerries: planning to collect ${targets.targetBerryCount} berries`);

    const candidates = getCandidates();
    if (candidates.length === 1 && candidates[0] === SWEET_BERRIES) {
      logger.debug('CollectBerries: skipping glow berries (no iron pickaxe)');
    }

    for (const itemName of candidates) {
      // Try with provided snapshot first
      if (targets.worldSnapshot) {
        currentPath = await tryPlanWithSnapshot(targets.worldSnapshot, itemName);
        if (currentPath) {
          selectedItem = itemName;
          logger.info(`CollectBerries: found path for ${itemName} with provided snapshot (${currentPath.length} steps)`);
          return;
        }
      }

      // Try adaptive snapshot with planner validation
      const radii = targets.snapshotRadii || DEFAULT_RADII;
      for (const radius of radii) {
        logger.debug(`CollectBerries: trying snapshot at radius ${radius} for ${itemName}`);
        try {
          const result = await captureAdaptiveSnapshot(bot, {
            radii: [radius],
            onProgress: (msg: string) => logger.debug(`CollectBerries: ${msg}`)
          });

          if (result.snapshot) {
            currentPath = await tryPlanWithSnapshot(result.snapshot, itemName);
            if (currentPath) {
              selectedItem = itemName;
              logger.info(`CollectBerries: found path for ${itemName} at radius ${radius} (${currentPath.length} steps)`);
              return;
            }
          }
        } catch (err: any) {
          logger.debug(`CollectBerries: snapshot at radius ${radius} failed - ${err?.message || err}`);
        }
      }
    }

    logger.info('CollectBerries: no viable path found for any berries');
    currentPath = null;
    selectedItem = null;
  }

  // Transitions
  const enterToPlanning = new StateTransition({
    parent: enter,
    child: planning,
    name: 'CollectBerries: enter -> planning',
    shouldTransition: () => phase === 'init',
    onTransition: () => {
      startCounts = {
        [SWEET_BERRIES]: getItemCountInInventory(bot, SWEET_BERRIES),
        [GLOW_BERRIES]: getItemCountInInventory(bot, GLOW_BERRIES)
      };
      phase = 'planning';
      logger.info(
        `CollectBerries: starting, current sweet=${startCounts[SWEET_BERRIES] || 0}, glow=${startCounts[GLOW_BERRIES] || 0}`
      );
    }
  });

  const planningToExecuting = new StateTransition({
    parent: planning,
    child: executing,
    name: 'CollectBerries: planning -> executing',
    shouldTransition: () => phase === 'executing' && currentPath !== null && pathStateMachine !== null,
    onTransition: () => {
      logger.info(`CollectBerries: executing plan with ${currentPath?.length || 0} steps for ${selectedItem || 'berries'}`);
    }
  });

  const planningToExit = new StateTransition({
    parent: planning,
    child: exit,
    name: 'CollectBerries: planning -> exit (failed)',
    shouldTransition: () => phase === 'failed',
    onTransition: () => {
      logger.info('CollectBerries: failed to find a viable plan');
    }
  });

  const executingToExit = new StateTransition({
    parent: executing,
    child: exit,
    name: 'CollectBerries: executing -> exit',
    shouldTransition: () => {
      if (!pathStateMachine) return phase === 'complete' || phase === 'failed';
      const finished = typeof pathStateMachine.isFinished === 'function'
        ? pathStateMachine.isFinished()
        : false;
      return finished;
    },
    onTransition: () => {
      const collected = getCollected(selectedItem);
      if (collected > 0) {
        phase = 'complete';
        logger.info(`CollectBerries: completed, collected ${collected} ${selectedItem}`);
      } else {
        phase = 'failed';
        logger.info('CollectBerries: execution completed but no berries collected');
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
  stateMachine.stateName = 'CollectBerries';

  // Handle planning state
  const planningAsAny = planning as any;
  const originalPlanningEntered = planningAsAny.onStateEntered;
  planningAsAny.onStateEntered = async function(this: any) {
    if (originalPlanningEntered) originalPlanningEntered.call(this);

    await generatePath();

    if (currentPath && currentPath.length > 0) {
      pathStateMachine = buildStateMachineForPath(bot, currentPath, (success: boolean) => {
        const collected = getCollected(selectedItem);
        if (success && collected > 0) {
          phase = 'complete';
        } else {
          phase = 'failed';
        }
        logger.info(`CollectBerries: path execution ${success ? 'succeeded' : 'failed'}`);
        pathStateMachine = null;
        currentPath = null;
      });
      phase = 'executing';
    } else {
      phase = 'failed';
    }
  };

  // Handle executing state - tick the path state machine
  const executingAsAny = executing as any;
  const originalExecutingEntered = executingAsAny.onStateEntered;
  executingAsAny.onStateEntered = function(this: any) {
    if (originalExecutingEntered) originalExecutingEntered.call(this);
    if (pathStateMachine && typeof pathStateMachine.onStateEntered === 'function') {
      logger.debug('CollectBerries: starting path sub-machine');
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
  (stateMachine as any).isFinished = () => reachedExit;
  (stateMachine as any).wasSuccessful = () => phase === 'complete';
  (stateMachine as any).getCollected = () => getCollected(selectedItem);

  const exitAsAny = exit as any;
  const originalExitEntered = exitAsAny.onStateEntered;
  exitAsAny.onStateEntered = function(this: any) {
    reachedExit = true;
    if (targets.onComplete) {
      targets.onComplete(phase === 'complete', getCollected(selectedItem), selectedItem);
    }
    if (originalExitEntered) {
      originalExitEntered.call(this);
    }
  };

  // Cleanup
  stateMachine.onStateExited = function() {
    logger.debug('CollectBerries: cleaning up');

    if (pathStateMachine && typeof pathStateMachine.onStateExited === 'function') {
      try { pathStateMachine.onStateExited(); } catch (_) {}
    }

    try { bot.clearControlStates?.(); } catch (_) {}
  };

  return stateMachine;
}

export default createCollectBerriesState;
