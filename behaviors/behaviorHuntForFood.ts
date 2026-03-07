/**
 * BehaviorHuntForFood - Hunt animals and collect drops
 * 
 * Orchestrates hunting any available animal and collecting dropped items.
 * Smelting raw meat is handled separately by the food smelting reactive behavior.
 */

const {
  StateTransition,
  BehaviorIdle,
  BehaviorGetClosestEntity,
  NestedStateMachine
} = require('mineflayer-statemachine');

import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
import { getInventoryObject, getItemCountInInventory } from '../utils/inventory';
import {
  HUNTABLE_LAND_ANIMALS,
  getCookedVariant,
  getFoodHungerPoints
} from '../utils/foodConfig';
import createHuntEntityState from './behaviorHuntEntity';
import { BehaviorSafeFollowEntity } from './behaviorSafeFollowEntity';
import {
  evaluateHuntDropCandidate,
  findClosestHuntableAnimal,
  getRawMeatDrop,
  hasSwordInInventory,
  isDropCollectTimedOut
} from './huntForFoodHelpers';

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

interface HuntForFoodTargets {
  targetFoodPoints: number;
  animalFilter?: string[];
  onComplete?: (success: boolean, foodGained: number) => void;
}

type Phase = 'init' | 'hunting' | 'collecting_drops' | 'complete' | 'failed';
type WeaponPhase = 'init' | 'done' | 'skipped';

const DROP_COLLECT_RADIUS = 8;
const DROP_COLLECT_TIMEOUT = 10000;
const DROP_COLLECT_MAX_ATTEMPTS = 10;
const DROP_PICKUP_WAIT_MS = 1500;

let lastDropLogTime = 0;
const DROP_LOG_INTERVAL_MS = 2000;

/**
 * Creates a state machine for hunting animals and cooking the meat
 */
function createHuntForFoodState(bot: Bot, targets: HuntForFoodTargets): any {
  let phase: Phase = 'init';
  let startFoodPoints = 0;
  let startRawMeatCounts: Map<string, number> = new Map();
  let huntedAnimalType: string | null = null;
  let rawMeatItem: string | null = null;
  let cookedMeatItem: string | null = null;
  let killPosition: any = null;
  let dropCollectStartTime = 0;
  let attemptedDropIds = new Set<number>();
  let dropAttemptCount = 0;
  let weaponPhase: WeaponPhase = 'init';
  
  // Shared targets for drop collection
  const dropTargets: any = {
    entity: null
  };
  
  // Create shared targets object that will be updated dynamically
  const huntTargets: any = {
    entity: null,
    entityFilter: (entity: any) => {
      if (!huntedAnimalType) return false;
      const name = (entity.name || '').toLowerCase();
      return name === huntedAnimalType;
    },
    detectionRange: 48,
    attackRange: 3.0,
    followRange: 2.0
  };
  
  // Pre-create the hunt state machine with dynamic targets
  const huntStateMachine = createHuntEntityState(bot, huntTargets);
  
  const enter = new BehaviorIdle();
  const prepareWeapon = new BehaviorIdle();
  const findAnimal = new BehaviorIdle();
  const exit = new BehaviorIdle();
  
  // Drop collection states
  const findDrop = new BehaviorGetClosestEntity(bot, dropTargets, (entity: any) => {
    const botPos = bot.entity?.position;
    const result = evaluateHuntDropCandidate({
      entity,
      botPos,
      killPosition,
      attemptedDropIds,
      dropCollectRadius: DROP_COLLECT_RADIUS,
      botRange: 16
    });

    if (!result.ok) return false;

    logger.debug(
      `HuntForFood: found drop near kill position: ${result.dropInfo.name} x${result.dropInfo.count}, dist=${result.distToKill.toFixed(2)}`
    );
    return true;
  });
  
  const goToDrop = new BehaviorSafeFollowEntity(bot, dropTargets);
  
  addStateLogging(enter, 'HuntForFood:Enter', { logEnter: true });
  addStateLogging(prepareWeapon, 'HuntForFood:PrepareWeapon', { logEnter: true });
  addStateLogging(findAnimal, 'HuntForFood:FindAnimal', { logEnter: true });
  addStateLogging(findDrop, 'HuntForFood:FindDrop', { logEnter: false });
  addStateLogging(goToDrop, 'HuntForFood:GoToDrop', { logEnter: false });
  
  function calculateCurrentFoodPoints(): number {
    const inventory = getInventoryObject(bot);
    let total = 0;
    for (const [item, count] of Object.entries(inventory)) {
      const points = getFoodHungerPoints(item);
      if (points > 0) total += points * count;
    }
    return total;
  }
  
  function captureStartRawMeatCounts(): void {
    startRawMeatCounts.clear();
    for (const animal of HUNTABLE_LAND_ANIMALS) {
      const rawItem = animal.drops[0];
      const count = getItemCountInInventory(bot, rawItem);
      startRawMeatCounts.set(rawItem, count);
    }
  }
  
  function getRawMeatGained(): number {
    let gained = 0;
    for (const animal of HUNTABLE_LAND_ANIMALS) {
      const rawItem = animal.drops[0];
      const startCount = startRawMeatCounts.get(rawItem) || 0;
      const currentCount = getItemCountInInventory(bot, rawItem);
      const delta = currentCount - startCount;
      if (delta > 0) {
        gained += delta * getFoodHungerPoints(rawItem);
      }
    }
    return gained;
  }

  function getRawMeatCollectedCount(): number {
    let collected = 0;
    for (const animal of HUNTABLE_LAND_ANIMALS) {
      const rawItem = animal.drops[0];
      const startCount = startRawMeatCounts.get(rawItem) || 0;
      const currentCount = getItemCountInInventory(bot, rawItem);
      const delta = currentCount - startCount;
      if (delta > 0) {
        collected += delta;
      }
    }
    return collected;
  }

  function hasCollectedRawMeat(): boolean {
    return getRawMeatCollectedCount() > 0;
  }
  
  function getFoodGained(): number {
    const pointsGained = calculateCurrentFoodPoints() - startFoodPoints;
    const rawMeatGained = getRawMeatGained();
    // Return the higher of the two - sometimes food points don't capture raw meat correctly
    return Math.max(pointsGained, rawMeatGained);
  }

  // Transitions
  
  const enterToFindAnimal = new StateTransition({
    parent: enter,
    child: findAnimal,
    name: 'HuntForFood: enter -> find animal',
    shouldTransition: () => true,
    onTransition: () => {
      phase = 'init';
      weaponPhase = 'init';
      startFoodPoints = calculateCurrentFoodPoints();
      captureStartRawMeatCounts();
      logger.info(`HuntForFood: starting, current food points = ${startFoodPoints}`);
    }
  });

  const findAnimalToPrepareWeapon = new StateTransition({
    parent: findAnimal,
    child: prepareWeapon,
    name: 'HuntForFood: find animal -> prepare weapon',
    shouldTransition: () => {
      const result = findClosestHuntableAnimal(bot, targets.animalFilter);
      if (result) {
        huntedAnimalType = result.animalType;
        rawMeatItem = getRawMeatDrop(result.animalType);
        cookedMeatItem = rawMeatItem ? getCookedVariant(rawMeatItem) : null;
        huntTargets.entity = result.entity;
        killPosition = result.entity.position?.clone?.() || { ...result.entity.position };
        return true;
      }
      return false;
    },
    onTransition: () => {
      logger.info(`HuntForFood: found ${huntedAnimalType}, preparing weapon before hunting for ${rawMeatItem} -> ${cookedMeatItem}`);
    }
  });

  const findAnimalToExit = new StateTransition({
    parent: findAnimal,
    child: exit,
    name: 'HuntForFood: find animal -> exit (no animals)',
    shouldTransition: () => {
      const result = findClosestHuntableAnimal(bot, targets.animalFilter);
      return !result;
    },
    onTransition: () => {
      phase = 'failed';
      logger.info('HuntForFood: no huntable animals found nearby');
    }
  });

  const prepareWeaponToHunting = new StateTransition({
    parent: prepareWeapon,
    child: huntStateMachine,
    name: 'HuntForFood: prepare weapon -> hunting',
    shouldTransition: () => weaponPhase === 'skipped' || weaponPhase === 'done',
    onTransition: () => {
      phase = 'hunting';
      logger.info(`HuntForFood: weapon ready, hunting ${huntedAnimalType}`);
    }
  });
  
  const huntingToExit = new StateTransition({
    parent: huntStateMachine,
    child: exit,
    name: 'HuntForFood: hunting -> exit (auto-collected)',
    shouldTransition: () => {
      const finished = typeof huntStateMachine.isFinished === 'function' 
        ? huntStateMachine.isFinished() 
        : false;
      if (!finished) return false;
      
      const gained = getFoodGained();
      return gained > 0;
    },
    onTransition: () => {
      phase = 'complete';
      const gained = getFoodGained();
      logger.info(`HuntForFood: hunt complete, gained ${gained} food points (auto-collected)`);
    }
  });
  
  // If hunt finished but no food gained yet, need to collect drops
  const huntingToFindDrop = new StateTransition({
    parent: huntStateMachine,
    child: findDrop,
    name: 'HuntForFood: hunting -> find drop',
    shouldTransition: () => {
      const finished = typeof huntStateMachine.isFinished === 'function' 
        ? huntStateMachine.isFinished() 
        : false;
      if (!finished) return false;
      
      // Only go to drop collection if we haven't gained food points yet
      const gained = getFoodGained();
      return gained === 0;
    },
    onTransition: () => {
      phase = 'collecting_drops';
      dropCollectStartTime = Date.now();
      dropTargets.entity = null;
      attemptedDropIds.clear();
      dropAttemptCount = 0;
      if (bot.entity?.position) {
        killPosition = bot.entity.position.clone?.() || { ...bot.entity.position };
      }
      logger.info(`HuntForFood: hunt complete but no food gained yet, searching for drops`);
    }
  });
  
  const findDropToGoToDrop = new StateTransition({
    parent: findDrop,
    child: goToDrop,
    name: 'HuntForFood: find drop -> go to drop',
    shouldTransition: () => {
      if (!dropTargets.entity) return false;
      // Verify entity ID exists and entity is still tracked
      const entityId = dropTargets.entity.id;
      if (entityId === undefined) return false;
      if (!bot.entities || !bot.entities[entityId]) {
        dropTargets.entity = null;
        return false;
      }
      return true;
    },
    onTransition: () => {
      const now = Date.now();
      if (now - lastDropLogTime >= DROP_LOG_INTERVAL_MS) {
        logger.debug('HuntForFood: found drop, moving to collect');
        lastDropLogTime = now;
      }
    }
  });
  
  const findDropToExit = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'HuntForFood: find drop -> exit',
    shouldTransition: () => dropTargets.entity === null || shouldStopDropCollection(),
    onTransition: () => {
      phase = hasCollectedRawMeat() ? 'complete' : 'failed';
      const gained = getFoodGained();
      logger.info(`HuntForFood: find drop exit (attempts=${dropAttemptCount}), phase=${phase}, food points=${gained}`);
    }
  });
  
  let reachedDropTime = 0;

  const goToDropToFindDrop = new StateTransition({
    parent: goToDrop,
    child: findDrop,
    name: 'HuntForFood: go to drop -> find drop (collected, look for more)',
    shouldTransition: () => {
      const entityId = dropTargets.entity?.id;
      if (entityId === undefined) {
        return true;
      }

      // Check if the drop entity still exists (if it despawned, we picked it up)
      const entityStillExists = bot.entities && bot.entities[entityId];
      if (!entityStillExists) {
        logger.debug(`HuntForFood: picked up drop (entity ${entityId} despawned)`);
        return true;
      }

      const dist = goToDrop.distanceToTarget?.() ?? 999;
      if (dist <= 2.0) {
        // Wait briefly for auto-pickup before moving on
        if (reachedDropTime === 0) {
          reachedDropTime = Date.now();
          return false;
        }
        return Date.now() - reachedDropTime >= DROP_PICKUP_WAIT_MS;
      }

      reachedDropTime = 0;
      return false;
    },
    onTransition: () => {
      dropAttemptCount++;
      reachedDropTime = 0;

      // Mark this entity as attempted so we don't try it again
      const entityId = dropTargets.entity?.id;
      if (entityId !== undefined) {
        attemptedDropIds.add(entityId);
      }
      dropTargets.entity = null;
    }
  });
  
  function shouldStopDropCollection(): boolean {
    return (
      isDropCollectTimedOut(dropCollectStartTime, Date.now(), DROP_COLLECT_TIMEOUT) ||
      dropAttemptCount >= DROP_COLLECT_MAX_ATTEMPTS
    );
  }
  
  const goToDropToExit = new StateTransition({
    parent: goToDrop,
    child: exit,
    name: 'HuntForFood: go to drop -> exit',
    shouldTransition: () => shouldStopDropCollection(),
    onTransition: () => {
      phase = hasCollectedRawMeat() ? 'complete' : 'failed';
      const gained = getFoodGained();
      logger.info(`HuntForFood: go to drop exit (attempts=${dropAttemptCount}), phase=${phase}, food points=${gained}`);
    }
  });
  
  const transitions = [
    enterToFindAnimal,
    findAnimalToPrepareWeapon,
    findAnimalToExit,
    prepareWeaponToHunting,
    huntingToExit,      // Fast path: drops auto-collected
    huntingToFindDrop,   // Slow path: need to find drops
    findDropToGoToDrop,
    findDropToExit,
    goToDropToFindDrop,
    goToDropToExit
  ];
  
  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  const prepareWeaponAsAny = prepareWeapon as any;
  const originalPrepareWeaponEntered = prepareWeaponAsAny.onStateEntered;
  prepareWeaponAsAny.onStateEntered = function(this: any) {
    if (originalPrepareWeaponEntered) originalPrepareWeaponEntered.call(this);

    weaponPhase = 'init';

    if (hasSwordInInventory(getInventoryObject(bot))) {
      logger.info('HuntForFood: sword already in inventory, skipping weapon craft');
      weaponPhase = 'done';
      return;
    }

    logger.info('HuntForFood: no sword in inventory, skipping weapon craft');
    weaponPhase = 'skipped';
  };
  
  let reachedExit = false;
  (stateMachine as any).isFinished = () => reachedExit;
  (stateMachine as any).wasSuccessful = () => phase === 'complete';
  (stateMachine as any).getFoodGained = getFoodGained;
  
  const exitAsAny = exit as any;
  const originalExitEntered = exitAsAny.onStateEntered;
  exitAsAny.onStateEntered = function(this: any) {
    reachedExit = true;
    if (targets.onComplete) {
      targets.onComplete(phase === 'complete', getFoodGained());
    }
    if (originalExitEntered) {
      originalExitEntered.call(this);
    }
  };
  
  stateMachine.onStateExited = function() {
    logger.debug('HuntForFood: cleaning up');

    if (huntStateMachine && typeof huntStateMachine.onStateExited === 'function') {
      try { huntStateMachine.onStateExited(); } catch (_) {}
    }
    
    try { bot.clearControlStates?.(); } catch (_) {}
  };
  
  return stateMachine;
}

export default createHuntForFoodState;
export { HuntForFoodTargets };
