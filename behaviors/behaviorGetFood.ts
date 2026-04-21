/**
 * BehaviorGetFood - Orchestrator for food collection
 * 
 * Tries multiple food sources in sequence with fallback:
 * 1. Hunt land animals
 * 2. Collect hay bales for bread
 * 3. Collect berries
 * 4. Mine melon blocks for melon slices
 * 5. Hunt water animals (fish) - last resort
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
  HUNTABLE_LAND_ANIMALS,
  HUNTABLE_WATER_ANIMALS,
  FoodCollectionConfig,
  DEFAULT_FOOD_CONFIG
} from '../utils/foodConfig';
import createHuntForFoodState from './behaviorHuntForFood';
import createHuntForFishState from './behaviorHuntForFish';
import createCollectBreadState, { BREAD_HUNGER_POINTS } from './behaviorCollectBread';
import createCollectMelonState, { MELON_SLICE_HUNGER_POINTS } from './behaviorCollectMelon';
import createCollectBerriesState, { BERRY_HUNGER_POINTS } from './behaviorCollectBerries';
import type { Bot } from '../behavior_generator/types';

interface GetFoodTargets {
  targetFoodPoints: number;
  minFoodThreshold?: number;
  onComplete?: (success: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  worldSnapshot?: any;
}

type FoodSource = 'hunt' | 'bread' | 'berries' | 'melon' | 'fish';
type Phase = 'init' | 'selecting' | 'hunt' | 'bread' | 'berries' | 'melon' | 'fish' | 'complete' | 'failed';

interface FoodSourceConfig {
  priority: number;
  maxAttempts: number;
  maxAttemptsWithoutGain?: number;
  blockTypes: string[];
  entityBased: boolean;
}

export const COOKED_FISH_HUNGER_POINTS = 6;

const FOOD_SOURCE_CONFIGS: Record<FoodSource, FoodSourceConfig> = {
  hunt: { priority: 1, maxAttempts: 10, maxAttemptsWithoutGain: 3, blockTypes: [], entityBased: true },
  bread: { priority: 2, maxAttempts: 5, blockTypes: ['hay_block'], entityBased: false },
  berries: { priority: 3, maxAttempts: 5, blockTypes: ['sweet_berry_bush', 'cave_vines', 'cave_vines_plant'], entityBased: false },
  melon: { priority: 4, maxAttempts: 5, blockTypes: ['melon'], entityBased: false },
  fish: { priority: 5, maxAttempts: 5, maxAttemptsWithoutGain: 2, blockTypes: [], entityBased: true },
};

class FoodSourceTracker {
  private attempts: Map<FoodSource, number> = new Map();
  private lastGainedFood: Map<FoodSource, boolean> = new Map();
  
  constructor() {
    this.reset();
  }
  
  reset(): void {
    for (const source of Object.keys(FOOD_SOURCE_CONFIGS) as FoodSource[]) {
      this.attempts.set(source, 0);
      this.lastGainedFood.set(source, false);
    }
  }
  
  getAttempts(source: FoodSource): number {
    return this.attempts.get(source) || 0;
  }
  
  incrementAttempts(source: FoodSource): number {
    const current = this.getAttempts(source);
    this.attempts.set(source, current + 1);
    return current + 1;
  }
  
  resetAttempts(source: FoodSource): void {
    this.attempts.set(source, 0);
  }
  
  setGainedFood(source: FoodSource, gained: boolean): void {
    this.lastGainedFood.set(source, gained);
    if (gained) {
      this.resetAttempts(source);
    }
  }
  
  lastGained(source: FoodSource): boolean {
    return this.lastGainedFood.get(source) || false;
  }
  
  canRetry(source: FoodSource, hasSourceNearby: boolean): boolean {
    const config = FOOD_SOURCE_CONFIGS[source];
    const attempts = this.getAttempts(source);
    
    if (attempts >= config.maxAttempts) {
      return false;
    }
    
    if (attempts === 0) {
      return true;
    }

    if (config.entityBased) {
      if (!hasSourceNearby) return false;
      const maxWithoutGain = config.maxAttemptsWithoutGain;
      if (maxWithoutGain != null && !this.lastGained(source) && attempts >= maxWithoutGain) {
        return false;
      }
      return true;
    }

    return hasSourceNearby && this.lastGained(source);
  }
  
  getDebugState(): string {
    const parts: string[] = [];
    for (const source of Object.keys(FOOD_SOURCE_CONFIGS) as FoodSource[]) {
      parts.push(`${source}:${this.getAttempts(source)}/${FOOD_SOURCE_CONFIGS[source].maxAttempts}`);
    }
    return parts.join(', ');
  }
}

/**
 * Creates a state machine for acquiring food with fallback strategy
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function createGetFoodState(bot: Bot, targets: GetFoodTargets): any {
  const config: FoodCollectionConfig = {
    triggerFoodPoints: targets.minFoodThreshold ?? DEFAULT_FOOD_CONFIG.triggerFoodPoints,
    minFoodThreshold: targets.minFoodThreshold ?? DEFAULT_FOOD_CONFIG.minFoodThreshold,
    targetFoodPoints: targets.targetFoodPoints ?? DEFAULT_FOOD_CONFIG.targetFoodPoints
  };
  
  let phase: Phase = 'init';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  let currentSubMachine: any = null;
  const tracker = new FoodSourceTracker();
  
  const enter = new BehaviorIdle();
  const selectSource = new BehaviorIdle();
  const huntingFood = new BehaviorIdle();
  const collectBread = new BehaviorIdle();
  const collectBerries = new BehaviorIdle();
  const collectMelon = new BehaviorIdle();
  const huntingFish = new BehaviorIdle();
  const exit = new BehaviorIdle();
  
  addStateLogging(enter, 'GetFood:Enter', { logEnter: true });
  addStateLogging(selectSource, 'GetFood:SelectSource', { logEnter: true });
  addStateLogging(huntingFood, 'GetFood:Hunting', { logEnter: true });
  addStateLogging(collectBread, 'GetFood:Bread', { logEnter: true });
  addStateLogging(collectBerries, 'GetFood:Berries', { logEnter: true });
  addStateLogging(collectMelon, 'GetFood:Melon', { logEnter: true });
  addStateLogging(huntingFish, 'GetFood:Fish', { logEnter: true });
  
  function getCurrentFoodPoints(): number {
    const inventory = getInventoryObject(bot);
    return calculateFoodPointsInInventory(inventory);
  }
  
  function checkAnimalsNearbyOnce(): boolean {
    if (!bot.entities) return false;
    const animalNames = new Set(HUNTABLE_LAND_ANIMALS.map(a => a.entity));
    
    for (const entity of Object.values(bot.entities)) {
      if (!entity || !entity.position) continue;
      const name = (entity.name || '').toLowerCase();
      if (animalNames.has(name)) {
        return true;
      }
    }
    return false;
  }
  
  function hasBlocksNearby(blockTypes: string[]): boolean {
    if (!targets.worldSnapshot?.blockCounts) {
      return false;
    }
    const counts = targets.worldSnapshot.blockCounts;
    for (const blockType of blockTypes) {
      if ((counts[blockType]?.count || 0) > 0) {
        return true;
      }
    }
    return false;
  }
  
  function hasFishNearby(): boolean {
    if (!bot.entities) return false;
    const fishNames = new Set(HUNTABLE_WATER_ANIMALS.map(a => a.entity));

    for (const entity of Object.values(bot.entities)) {
      if (!entity || !entity.position) continue;
      const name = (entity.name || '').toLowerCase();
      if (fishNames.has(name)) {
        logger.debug(`GetFood: found huntable fish: ${name}`);
        return true;
      }
    }
    return false;
  }

  function hasSourceNearby(source: FoodSource): boolean {
    const sourceConfig = FOOD_SOURCE_CONFIGS[source];
    
    if (source === 'fish') {
      return hasFishNearby();
    }

    if (sourceConfig.entityBased) {
      return checkAnimalsNearbyOnce();
    }
    
    if (sourceConfig.blockTypes.length > 0) {
      return hasBlocksNearby(sourceConfig.blockTypes);
    }
    
    return false;
  }
  
  function selectNextSource(): FoodSource | null {
    logger.debug(`GetFood: selectNextSource - tracker state: ${tracker.getDebugState()}`);
    
    const sources: FoodSource[] = ['hunt', 'bread', 'berries', 'melon', 'fish'];
    
    for (const source of sources) {
      const nearby = hasSourceNearby(source);
      const canRetry = tracker.canRetry(source, nearby);
      
      logger.debug(`GetFood: checking ${source} - nearby=${nearby}, canRetry=${canRetry}`);
      
      if (canRetry) {
        return source;
      }
    }
    
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
      case 'fish':
        return Math.ceil(neededPoints / COOKED_FISH_HUNGER_POINTS);
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
      tracker.reset();
      logger.info(`GetFood: starting, current food = ${getCurrentFoodPoints()}, target = ${config.targetFoodPoints}`);
    }
  });
  
  const selectToHunt = new StateTransition({
    parent: selectSource,
    child: huntingFood,
    name: 'GetFood: select -> hunting',
    shouldTransition: () => phase === 'hunt',
    onTransition: () => {
      const attempts = tracker.incrementAttempts('hunt');
      const maxAttempts = FOOD_SOURCE_CONFIGS.hunt.maxAttempts;
      const count = calculateNeededCount('hunt');
      logger.info(`GetFood: trying hunting (attempt ${attempts}/${maxAttempts}), need ~${count} animals`);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      currentSubMachine = createHuntForFoodState(bot as any, {
        targetFoodPoints: config.targetFoodPoints,
        onComplete: (success: boolean, foodGained: number) => {
          logger.info(`GetFood: hunting ${success ? 'succeeded' : 'failed'}, gained ${foodGained} points`);
          tracker.setGainedFood('hunt', foodGained > 0);
          
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
      const attempts = tracker.incrementAttempts('bread');
      const maxAttempts = FOOD_SOURCE_CONFIGS.bread.maxAttempts;
      const count = calculateNeededCount('bread');
      logger.info(`GetFood: trying bread collection (attempt ${attempts}/${maxAttempts}), need ${count} bread`);
      
      currentSubMachine = createCollectBreadState(bot, {
        targetBreadCount: count,
        worldSnapshot: targets.worldSnapshot,
        onComplete: (success: boolean, collected: number) => {
          logger.info(`GetFood: bread collection ${success ? 'succeeded' : 'failed'}, collected ${collected}`);
          tracker.setGainedFood('bread', collected > 0);
          
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
      const attempts = tracker.incrementAttempts('melon');
      const maxAttempts = FOOD_SOURCE_CONFIGS.melon.maxAttempts;
      const count = calculateNeededCount('melon');
      logger.info(`GetFood: trying melon collection (attempt ${attempts}/${maxAttempts}), need ${count} melon slices`);
      
      currentSubMachine = createCollectMelonState(bot, {
        targetMelonCount: count,
        worldSnapshot: targets.worldSnapshot,
        onComplete: (success: boolean, collected: number) => {
          logger.info(`GetFood: melon collection ${success ? 'succeeded' : 'failed'}, collected ${collected}`);
          tracker.setGainedFood('melon', collected > 0);
          
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
      const attempts = tracker.incrementAttempts('berries');
      const maxAttempts = FOOD_SOURCE_CONFIGS.berries.maxAttempts;
      const count = calculateNeededCount('berries');
      logger.info(`GetFood: trying berries collection (attempt ${attempts}/${maxAttempts}), need ${count} berries`);

      currentSubMachine = createCollectBerriesState(bot, {
        targetBerryCount: count,
        worldSnapshot: targets.worldSnapshot,
        requireIronForGlow: true,
        onComplete: (success: boolean, collected: number, itemName: string | null) => {
          logger.info(`GetFood: berries collection ${success ? 'succeeded' : 'failed'}, collected ${collected} ${itemName || 'berries'}`);
          tracker.setGainedFood('berries', collected > 0);
          
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
  
  const selectToFish = new StateTransition({
    parent: selectSource,
    child: huntingFish,
    name: 'GetFood: select -> fish',
    shouldTransition: () => phase === 'fish',
    onTransition: () => {
      const attempts = tracker.incrementAttempts('fish');
      const maxAttempts = FOOD_SOURCE_CONFIGS.fish.maxAttempts;
      const count = calculateNeededCount('fish');
      logger.info(`GetFood: trying fish hunting (attempt ${attempts}/${maxAttempts}), need ~${count} fish`);

      currentSubMachine = createHuntForFishState(bot, {
        targetFoodPoints: config.targetFoodPoints,
        onComplete: (success: boolean, foodGained: number) => {
          logger.info(`GetFood: fish hunting ${success ? 'succeeded' : 'failed'}, gained ${foodGained} points`);
          tracker.setGainedFood('fish', foodGained > 0);

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
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  function makeSourceTransitions(parent: any, label: string): [any, any] {
    const toSelect = new StateTransition({
      parent,
      child: selectSource,
      name: `GetFood: ${label} -> select`,
      shouldTransition: () => {
        if (!currentSubMachine) return phase === 'selecting';
        const finished = typeof currentSubMachine.isFinished === 'function'
          ? currentSubMachine.isFinished()
          : false;
        return finished && phase === 'selecting';
      }
    });

    const toExit = new StateTransition({
      parent,
      child: exit,
      name: `GetFood: ${label} -> exit`,
      shouldTransition: () => {
        if (!currentSubMachine) return phase === 'complete' || phase === 'failed';
        const finished = typeof currentSubMachine.isFinished === 'function'
          ? currentSubMachine.isFinished()
          : false;
        return finished && (phase === 'complete' || phase === 'failed');
      }
    });

    return [toSelect, toExit];
  }

  const [huntToSelect, huntToExit] = makeSourceTransitions(huntingFood, 'hunt');
  const [breadToSelect, breadToExit] = makeSourceTransitions(collectBread, 'bread');
  const [berriesToSelect, berriesToExit] = makeSourceTransitions(collectBerries, 'berries');
  const [melonToSelect, melonToExit] = makeSourceTransitions(collectMelon, 'melon');
  const [fishToSelect, fishToExit] = makeSourceTransitions(huntingFish, 'fish');
  
  // Hook into sub-machine states to start and tick them
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  function hookupSubMachine(state: any, label: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const stateAsAny = state as any;
    const originalEntered = stateAsAny.onStateEntered;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    stateAsAny.onStateEntered = function(this: any) {
      if (originalEntered) originalEntered.call(this);
      if (currentSubMachine && typeof currentSubMachine.onStateEntered === 'function') {
        logger.info(`GetFood: starting ${label} sub-machine`);
        currentSubMachine.onStateEntered();
      }
    };
    stateAsAny.update = function() {
      if (currentSubMachine && typeof currentSubMachine.update === 'function') {
        currentSubMachine.update();
      }
    };
  }

  hookupSubMachine(huntingFood, 'hunt');
  hookupSubMachine(collectBread, 'bread');
  hookupSubMachine(collectBerries, 'berries');
  hookupSubMachine(collectMelon, 'melon');
  hookupSubMachine(huntingFish, 'fish hunt');
  
  const transitions = [
    enterToSelect,
    selectToHunt,
    selectToBread,
    selectToBerries,
    selectToMelon,
    selectToFish,
    selectToExit,
    huntToSelect,
    huntToExit,
    breadToSelect,
    breadToExit,
    berriesToSelect,
    berriesToExit,
    melonToSelect,
    melonToExit,
    fishToSelect,
    fishToExit
  ];
  
  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  
  // Handle source selection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const selectAsAny = selectSource as any;
  const originalSelectEntered = selectAsAny.onStateEntered;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  selectAsAny.onStateEntered = function(this: any) {
    if (originalSelectEntered) originalSelectEntered.call(this);

    phase = 'selecting';

    // Check if we already have enough food
    if (getCurrentFoodPoints() >= config.targetFoodPoints) {
      phase = 'complete';
      return;
    }

    checkAnimalsNearbyOnce();

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  (stateMachine as any).isFinished = () => reachedExit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  (stateMachine as any).wasSuccessful = () => phase === 'complete';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  (stateMachine as any).getCurrentFoodPoints = getCurrentFoodPoints;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const exitAsAny = exit as any;
  const originalExitEntered = exitAsAny.onStateEntered;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
