/**
 * BehaviorGetFood - Orchestrator for food collection
 * 
 * Tries multiple food sources in sequence with fallback:
 * 1. Hunt animals
 * 2. Collect hay bales for bread
 * 3. Mine melon blocks for melon slices
 * 
 * Wraps the decomposed food collection behaviors.
 */

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getInventoryObject } from '../utils/inventory';
import {
  calculateFoodPointsInInventory,
  HUNTABLE_ANIMALS,
  FoodCollectionConfig,
  DEFAULT_FOOD_CONFIG
} from '../utils/foodConfig';
import createHuntForFoodState from './behaviorHuntForFood';
import createCollectBreadState, { BREAD_HUNGER_POINTS } from './behaviorCollectBread';
import createCollectMelonState, { MELON_SLICE_HUNGER_POINTS } from './behaviorCollectMelon';
import createCollectBerriesState, { BERRY_HUNGER_POINTS } from './behaviorCollectBerries';

interface Bot {
  version?: string;
  entity?: { position: any; health?: number; yaw: number; pitch: number };
  entities?: Record<string, any>;
  inventory?: any;
  clearControlStates?: () => void;
  pvp?: any;
  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  [key: string]: any;
}

interface GetFoodTargets {
  targetFoodPoints: number;
  minFoodThreshold?: number;
  onComplete?: (success: boolean) => void;
  worldSnapshot?: any;
}

type FoodSource = 'hunt' | 'bread' | 'berries' | 'melon';
type Phase = 'init' | 'selecting' | 'hunt' | 'bread' | 'berries' | 'melon' | 'complete' | 'failed';

/**
 * Creates a state machine for acquiring food with fallback strategy
 */
function createGetFoodState(bot: Bot, targets: GetFoodTargets): any {
  const config: FoodCollectionConfig = {
    triggerFoodPoints: targets.minFoodThreshold ?? DEFAULT_FOOD_CONFIG.triggerFoodPoints,
    minFoodThreshold: targets.minFoodThreshold ?? DEFAULT_FOOD_CONFIG.minFoodThreshold,
    targetFoodPoints: targets.targetFoodPoints ?? DEFAULT_FOOD_CONFIG.targetFoodPoints
  };
  
  let phase: Phase = 'init';
  let triedSources = new Set<FoodSource>();
  let currentSubMachine: any = null;
  let huntAttempts = 0;
  let lastHuntGainedFood = false;
  const MAX_HUNT_ATTEMPTS = 10;
  
  const enter = new BehaviorIdle();
  const selectSource = new BehaviorIdle();
  const huntingFood = new BehaviorIdle();
  const collectBread = new BehaviorIdle();
  const collectBerries = new BehaviorIdle();
  const collectMelon = new BehaviorIdle();
  const exit = new BehaviorIdle();
  
  addStateLogging(enter, 'GetFood:Enter', { logEnter: true });
  addStateLogging(selectSource, 'GetFood:SelectSource', { logEnter: true });
  addStateLogging(huntingFood, 'GetFood:Hunting', { logEnter: true });
  addStateLogging(collectBread, 'GetFood:Bread', { logEnter: true });
  addStateLogging(collectBerries, 'GetFood:Berries', { logEnter: true });
  addStateLogging(collectMelon, 'GetFood:Melon', { logEnter: true });
  
  function getCurrentFoodPoints(): number {
    const inventory = getInventoryObject(bot);
    return calculateFoodPointsInInventory(inventory);
  }
  
  function checkAnimalsNearbyOnce(): boolean {
    if (!bot.entities) return false;
    const animalNames = new Set(HUNTABLE_ANIMALS.map(a => a.entity));
    
    for (const entity of Object.values(bot.entities)) {
      if (!entity || !entity.position) continue;
      const name = (entity.name || '').toLowerCase();
      if (animalNames.has(name)) {
        return true;
      }
    }
    return false;
  }
  
  function hasAnimalsNearby(): boolean {
    if (!bot.entities) {
      logger.debug('GetFood: bot.entities is null/undefined');
      return false;
    }
    const animalNames = new Set(HUNTABLE_ANIMALS.map(a => a.entity));
    
    const entityNames: string[] = [];
    for (const entity of Object.values(bot.entities)) {
      if (!entity || !entity.position) continue;
      const name = (entity.name || '').toLowerCase();
      entityNames.push(name);
      if (animalNames.has(name)) {
        logger.debug(`GetFood: found huntable animal: ${name}`);
        return true;
      }
    }
    logger.debug(`GetFood: no huntable animals in ${entityNames.length} entities. Looking for: ${Array.from(animalNames).join(',')}. Found: ${entityNames.slice(0, 20).join(',')}`);
    return false;
  }
  
  async function waitForEntities(): Promise<boolean> {
    const MAX_ATTEMPTS = 4;
    const DELAY_MS = 500;
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (checkAnimalsNearbyOnce()) {
        logger.debug(`GetFood: found animals on attempt ${attempt}/${MAX_ATTEMPTS}`);
        return true;
      }
      if (attempt < MAX_ATTEMPTS) {
        logger.debug(`GetFood: no animals found on attempt ${attempt}/${MAX_ATTEMPTS}, waiting ${DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
    logger.debug(`GetFood: no animals found after ${MAX_ATTEMPTS} attempts`);
    return false;
  }
  
  function selectNextSource(): FoodSource | null {
    const animalsNearby = hasAnimalsNearby();
    
    logger.debug(`GetFood: selectNextSource - animalsNearby=${animalsNearby}, huntAttempts=${huntAttempts}, lastHuntGained=${lastHuntGainedFood}, tried=${Array.from(triedSources).join(',')}`);
    
    // Priority 1: Always try hunting first - animals may spawn/appear later
    // Keep hunting if animals are nearby and under max attempts
    if (huntAttempts < MAX_HUNT_ATTEMPTS) {
      // First attempt or animals are nearby - go hunt
      if (huntAttempts === 0 || animalsNearby) {
        return 'hunt';
      }
    }
    
    // Priority 2: Block-based food sources (only after hunting is exhausted)
    // Try bread
    if (!triedSources.has('bread')) {
      return 'bread';
    }
    
    // Try berries
    if (!triedSources.has('berries')) {
      return 'berries';
    }

    // Try melon
    if (!triedSources.has('melon')) {
      return 'melon';
    }
    
    // All sources exhausted
    return null;
  }
  
  function calculateNeededCount(source: FoodSource): number {
    const currentPoints = getCurrentFoodPoints();
    const neededPoints = Math.max(0, config.targetFoodPoints - currentPoints);
    
    switch (source) {
      case 'hunt':
        return Math.ceil(neededPoints / 8); // ~8 points per cooked meat
      case 'bread':
        return Math.ceil(neededPoints / BREAD_HUNGER_POINTS);
      case 'berries':
        return Math.ceil(neededPoints / BERRY_HUNGER_POINTS);
      case 'melon':
        return Math.ceil(neededPoints / MELON_SLICE_HUNGER_POINTS);
      default:
        return 1;
    }
  }
  
  // Transitions
  
  const enterToSelect = new StateTransition({
    parent: enter,
    child: selectSource,
    name: 'GetFood: enter -> select source',
    shouldTransition: () => true,
    onTransition: () => {
      phase = 'init';
      triedSources.clear();
      huntAttempts = 0;
      lastHuntGainedFood = false;
      logger.info(`GetFood: starting, current food = ${getCurrentFoodPoints()}, target = ${config.targetFoodPoints}`);
    }
  });
  
  const selectToHunt = new StateTransition({
    parent: selectSource,
    child: huntingFood,
    name: 'GetFood: select -> hunting',
    shouldTransition: () => phase === 'hunt',
    onTransition: () => {
      huntAttempts++;
      const count = calculateNeededCount('hunt');
      logger.info(`GetFood: trying hunting (attempt ${huntAttempts}/${MAX_HUNT_ATTEMPTS}), need ~${count} animals`);
      
      currentSubMachine = createHuntForFoodState(bot, {
        targetFoodPoints: config.targetFoodPoints,
        onComplete: (success: boolean, foodGained: number) => {
          logger.info(`GetFood: hunting ${success ? 'succeeded' : 'failed'}, gained ${foodGained} points`);
          lastHuntGainedFood = foodGained > 0;
          
          // If hunt was successful, reset attempt counter to allow more hunts
          if (foodGained > 0) {
            huntAttempts = 0;
          }
          
          currentSubMachine = null;
          
          if (getCurrentFoodPoints() >= config.targetFoodPoints) {
            phase = 'complete';
          } else {
            phase = 'selecting';
          }
        }
      });
    }
  });
  
  const selectToBread = new StateTransition({
    parent: selectSource,
    child: collectBread,
    name: 'GetFood: select -> bread',
    shouldTransition: () => phase === 'bread',
    onTransition: () => {
      triedSources.add('bread');
      const count = calculateNeededCount('bread');
      logger.info(`GetFood: trying bread collection, need ${count} bread`);
      
      currentSubMachine = createCollectBreadState(bot, {
        targetBreadCount: count,
        worldSnapshot: targets.worldSnapshot,
        onComplete: (success: boolean, collected: number) => {
          logger.info(`GetFood: bread collection ${success ? 'succeeded' : 'failed'}, collected ${collected}`);
          currentSubMachine = null;
          
          if (getCurrentFoodPoints() >= config.targetFoodPoints) {
            phase = 'complete';
          } else {
            phase = 'selecting';
          }
        }
      });
    }
  });
  
  const selectToMelon = new StateTransition({
    parent: selectSource,
    child: collectMelon,
    name: 'GetFood: select -> melon',
    shouldTransition: () => phase === 'melon',
    onTransition: () => {
      triedSources.add('melon');
      const count = calculateNeededCount('melon');
      logger.info(`GetFood: trying melon collection, need ${count} melon slices`);
      
      currentSubMachine = createCollectMelonState(bot, {
        targetMelonCount: count,
        worldSnapshot: targets.worldSnapshot,
        onComplete: (success: boolean, collected: number) => {
          logger.info(`GetFood: melon collection ${success ? 'succeeded' : 'failed'}, collected ${collected}`);
          currentSubMachine = null;
          
          if (getCurrentFoodPoints() >= config.targetFoodPoints) {
            phase = 'complete';
          } else {
            phase = 'selecting';
          }
        }
      });
    }
  });

  const selectToBerries = new StateTransition({
    parent: selectSource,
    child: collectBerries,
    name: 'GetFood: select -> berries',
    shouldTransition: () => phase === 'berries',
    onTransition: () => {
      triedSources.add('berries');
      const count = calculateNeededCount('berries');
      logger.info(`GetFood: trying berries collection, need ${count} berries`);

      currentSubMachine = createCollectBerriesState(bot, {
        targetBerryCount: count,
        worldSnapshot: targets.worldSnapshot,
        requireIronForGlow: true,
        onComplete: (success: boolean, collected: number, itemName: string | null) => {
          logger.info(`GetFood: berries collection ${success ? 'succeeded' : 'failed'}, collected ${collected} ${itemName || 'berries'}`);
          currentSubMachine = null;

          if (getCurrentFoodPoints() >= config.targetFoodPoints) {
            phase = 'complete';
          } else {
            phase = 'selecting';
          }
        }
      });
    }
  });
  
  const selectToExit = new StateTransition({
    parent: selectSource,
    child: exit,
    name: 'GetFood: select -> exit',
    shouldTransition: () => phase === 'complete' || phase === 'failed',
    onTransition: () => {
      const points = getCurrentFoodPoints();
      logger.info(`GetFood: ${phase}, final food points = ${points}`);
    }
  });
  
  const huntToSelect = new StateTransition({
    parent: huntingFood,
    child: selectSource,
    name: 'GetFood: hunt -> select',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'selecting';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && phase === 'selecting';
    },
    onTransition: () => {
      logger.info('GetFood: hunt complete, checking if more food needed');
    }
  });
  
  const huntToExit = new StateTransition({
    parent: huntingFood,
    child: exit,
    name: 'GetFood: hunt -> exit',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'complete' || phase === 'failed';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && (phase === 'complete' || phase === 'failed');
    }
  });
  
  const breadToSelect = new StateTransition({
    parent: collectBread,
    child: selectSource,
    name: 'GetFood: bread -> select',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'selecting';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && phase === 'selecting';
    }
  });
  
  const breadToExit = new StateTransition({
    parent: collectBread,
    child: exit,
    name: 'GetFood: bread -> exit',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'complete' || phase === 'failed';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && (phase === 'complete' || phase === 'failed');
    }
  });

  const berriesToSelect = new StateTransition({
    parent: collectBerries,
    child: selectSource,
    name: 'GetFood: berries -> select',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'selecting';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && phase === 'selecting';
    }
  });

  const berriesToExit = new StateTransition({
    parent: collectBerries,
    child: exit,
    name: 'GetFood: berries -> exit',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'complete' || phase === 'failed';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && (phase === 'complete' || phase === 'failed');
    }
  });
  
  const melonToSelect = new StateTransition({
    parent: collectMelon,
    child: selectSource,
    name: 'GetFood: melon -> select',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'selecting';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && phase === 'selecting';
    }
  });
  
  const melonToExit = new StateTransition({
    parent: collectMelon,
    child: exit,
    name: 'GetFood: melon -> exit',
    shouldTransition: () => {
      if (!currentSubMachine) return phase === 'complete' || phase === 'failed';
      const finished = typeof currentSubMachine.isFinished === 'function'
        ? currentSubMachine.isFinished()
        : false;
      return finished && (phase === 'complete' || phase === 'failed');
    }
  });
  
  // Hook into hunting state to start and tick the sub-machine
  const huntingAsAny = huntingFood as any;
  const originalHuntingEntered = huntingAsAny.onStateEntered;
  huntingAsAny.onStateEntered = function(this: any) {
    if (originalHuntingEntered) originalHuntingEntered.call(this);
    if (currentSubMachine && typeof currentSubMachine.onStateEntered === 'function') {
      logger.info('GetFood: starting hunt sub-machine');
      currentSubMachine.onStateEntered();
    }
  };
  huntingAsAny.update = function() {
    if (currentSubMachine && typeof currentSubMachine.update === 'function') {
      currentSubMachine.update();
    }
  };
  
  // Hook into bread state to start and tick the sub-machine
  const breadAsAny = collectBread as any;
  const originalBreadEntered = breadAsAny.onStateEntered;
  breadAsAny.onStateEntered = function(this: any) {
    if (originalBreadEntered) originalBreadEntered.call(this);
    if (currentSubMachine && typeof currentSubMachine.onStateEntered === 'function') {
      logger.info('GetFood: starting bread sub-machine');
      currentSubMachine.onStateEntered();
    }
  };
  breadAsAny.update = function() {
    if (currentSubMachine && typeof currentSubMachine.update === 'function') {
      currentSubMachine.update();
    }
  };

  // Hook into berries state to start and tick the sub-machine
  const berriesAsAny = collectBerries as any;
  const originalBerriesEntered = berriesAsAny.onStateEntered;
  berriesAsAny.onStateEntered = function(this: any) {
    if (originalBerriesEntered) originalBerriesEntered.call(this);
    if (currentSubMachine && typeof currentSubMachine.onStateEntered === 'function') {
      logger.info('GetFood: starting berries sub-machine');
      currentSubMachine.onStateEntered();
    }
  };
  berriesAsAny.update = function() {
    if (currentSubMachine && typeof currentSubMachine.update === 'function') {
      currentSubMachine.update();
    }
  };
  
  // Hook into melon state to start and tick the sub-machine
  const melonAsAny = collectMelon as any;
  const originalMelonEntered = melonAsAny.onStateEntered;
  melonAsAny.onStateEntered = function(this: any) {
    if (originalMelonEntered) originalMelonEntered.call(this);
    if (currentSubMachine && typeof currentSubMachine.onStateEntered === 'function') {
      logger.info('GetFood: starting melon sub-machine');
      currentSubMachine.onStateEntered();
    }
  };
  melonAsAny.update = function() {
    if (currentSubMachine && typeof currentSubMachine.update === 'function') {
      currentSubMachine.update();
    }
  };
  
  const transitions = [
    enterToSelect,
    selectToHunt,
    selectToBread,
    selectToBerries,
    selectToMelon,
    selectToExit,
    huntToSelect,
    huntToExit,
    breadToSelect,
    breadToExit,
    berriesToSelect,
    berriesToExit,
    melonToSelect,
    melonToExit
  ];
  
  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  
  // Handle source selection
  let isFirstSelection = true;
  const selectAsAny = selectSource as any;
  const originalSelectEntered = selectAsAny.onStateEntered;
  selectAsAny.onStateEntered = async function(this: any) {
    if (originalSelectEntered) originalSelectEntered.call(this);
    
    phase = 'selecting';
    
    // Check if we already have enough food
    if (getCurrentFoodPoints() >= config.targetFoodPoints) {
      phase = 'complete';
      return;
    }
    
    // On first selection, wait for entities to load (they may not be ready at spawn)
    if (isFirstSelection) {
      isFirstSelection = false;
      logger.debug('GetFood: first selection, waiting for entities to load...');
      await waitForEntities();
    }
    
    const nextSource = selectNextSource();
    
    if (!nextSource) {
      logger.info('GetFood: no more food sources available');
      phase = 'failed';
      return;
    }
    
    logger.info(`GetFood: selected source: ${nextSource}`);
    phase = nextSource;
  };
  
  let reachedExit = false;
  (stateMachine as any).isFinished = () => reachedExit;
  (stateMachine as any).wasSuccessful = () => phase === 'complete';
  (stateMachine as any).getCurrentFoodPoints = getCurrentFoodPoints;
  
  const exitAsAny = exit as any;
  const originalExitEntered = exitAsAny.onStateEntered;
  exitAsAny.onStateEntered = function(this: any) {
    reachedExit = true;
    if (targets.onComplete) {
      targets.onComplete(phase === 'complete');
    }
    if (originalExitEntered) {
      originalExitEntered.call(this);
    }
  };
  
  stateMachine.onStateExited = function() {
    logger.info('GetFood: cleaning up');
    
    if (currentSubMachine && typeof currentSubMachine.onStateExited === 'function') {
      try { currentSubMachine.onStateExited(); } catch (_) {}
    }
    
    try { bot.clearControlStates?.(); } catch (_) {}
  };
  
  return stateMachine;
}

export default createGetFoodState;
export { GetFoodTargets, FoodCollectionConfig };
