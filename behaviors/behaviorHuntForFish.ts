/**
 * BehaviorHuntForFish - Hunt water animals (salmon, cod) and cook the fish
 *
 * Variant of BehaviorHuntForFood that targets water animals.
 * Only attempts weapon crafting after a huntable fish entity is found.
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
import { buildStateMachineForPath } from '../behavior_generator/buildMachine';
import { plan as planner, _internals as plannerInternals } from '../planner';
import { captureAdaptiveSnapshot } from '../utils/adaptiveSnapshot';
import {
  HUNTABLE_WATER_ANIMALS,
  getCookedVariant,
  getFoodHungerPoints
} from '../utils/foodConfig';
import createHuntEntityState from './behaviorHuntEntity';
import createSmeltState from './behaviorSmelt';
import { BehaviorSafeFollowEntity } from './behaviorSafeFollowEntity';
import {
  countRawMeatInInventory,
  evaluateHuntDropCandidate,
  findClosestHuntableAnimal,
  getRawMeatDrop,
  hasSwordInInventory,
  isDropCollectTimedOut
} from './huntForFoodHelpers';
const minecraftData = require('minecraft-data');

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

interface HuntForFishTargets {
  targetFoodPoints: number;
  animalFilter?: string[];
  onComplete?: (success: boolean, foodGained: number) => void;
}

type Phase = 'init' | 'hunting' | 'collecting_drops' | 'smelting' | 'complete' | 'failed';
type WeaponPhase = 'init' | 'planning' | 'executing' | 'done' | 'skipped';

const DROP_COLLECT_RADIUS = 8;
const DROP_COLLECT_TIMEOUT = 10000;
const DROP_COLLECT_MAX_ATTEMPTS = 10;
const DROP_PICKUP_WAIT_TIME = 1500;
const WEAPON_SNAPSHOT_RADII = [32, 64, 96, 128];

let lastDropLogTime = 0;
const DROP_LOG_INTERVAL_MS = 2000;

function createHuntForFishState(bot: Bot, targets: HuntForFishTargets): any {
  let phase: Phase = 'init';
  let startFoodPoints = 0;
  let startRawFishCounts: Map<string, number> = new Map();
  let huntedAnimalType: string | null = null;
  let rawFishItem: string | null = null;
  let cookedFishItem: string | null = null;
  let killPosition: any = null;
  let dropCollectStartTime = 0;
  let attemptedDropIds = new Set<number>();
  let dropAttemptCount = 0;
  let weaponPhase: WeaponPhase = 'init';
  let weaponPath: any[] | null = null;
  let weaponStateMachine: any = null;

  const dropTargets: any = {
    entity: null
  };

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

  const huntStateMachine = createHuntEntityState(bot, huntTargets);

  let smeltStateMachine: any = null;

  const enter = new BehaviorIdle();
  const findAnimal = new BehaviorIdle();
  const prepareWeapon = new BehaviorIdle();
  const smelting = new BehaviorIdle();
  const exit = new BehaviorIdle();

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
      `HuntForFish: found drop near kill position: ${result.dropInfo.name} x${result.dropInfo.count}, dist=${result.distToKill.toFixed(2)}`
    );
    return true;
  });

  const goToDrop = new BehaviorSafeFollowEntity(bot, dropTargets);

  addStateLogging(enter, 'HuntForFish:Enter', { logEnter: true });
  addStateLogging(findAnimal, 'HuntForFish:FindAnimal', { logEnter: true });
  addStateLogging(prepareWeapon, 'HuntForFish:PrepareWeapon', { logEnter: true });
  addStateLogging(findDrop, 'HuntForFish:FindDrop', { logEnter: false });
  addStateLogging(goToDrop, 'HuntForFish:GoToDrop', { logEnter: false });
  addStateLogging(smelting, 'HuntForFish:Smelting', { logEnter: true });

  function calculateCurrentFoodPoints(): number {
    const inventory = getInventoryObject(bot);
    let total = 0;
    for (const [item, count] of Object.entries(inventory)) {
      const points = getFoodHungerPoints(item);
      if (points > 0) total += points * count;
    }
    return total;
  }

  function captureStartRawFishCounts(): void {
    startRawFishCounts.clear();
    for (const animal of HUNTABLE_WATER_ANIMALS) {
      const rawItem = animal.drops[0];
      const count = getItemCountInInventory(bot, rawItem);
      startRawFishCounts.set(rawItem, count);
    }
  }

  function getRawFishGained(): number {
    let gained = 0;
    for (const animal of HUNTABLE_WATER_ANIMALS) {
      const rawItem = animal.drops[0];
      const startCount = startRawFishCounts.get(rawItem) || 0;
      const currentCount = getItemCountInInventory(bot, rawItem);
      const delta = currentCount - startCount;
      if (delta > 0) {
        gained += delta * getFoodHungerPoints(rawItem);
      }
    }
    return gained;
  }

  function getRawFishCollectedCount(): number {
    let collected = 0;
    for (const animal of HUNTABLE_WATER_ANIMALS) {
      const rawItem = animal.drops[0];
      const startCount = startRawFishCounts.get(rawItem) || 0;
      const currentCount = getItemCountInInventory(bot, rawItem);
      const delta = currentCount - startCount;
      if (delta > 0) {
        collected += delta;
      }
    }
    return collected;
  }

  function hasCollectedRawFish(): boolean {
    return getRawFishCollectedCount() > 0;
  }

  function getFoodGained(): number {
    const pointsGained = calculateCurrentFoodPoints() - startFoodPoints;
    const rawFishGained = getRawFishGained();
    return Math.max(pointsGained, rawFishGained);
  }

  async function tryPlanWeaponWithSnapshot(snapshot: any): Promise<any[] | null> {
    try {
      const inventory = getInventoryObject(bot);
      const inventoryMap = new Map(Object.entries(inventory));
      const version = bot.version || '1.20.1';
      const mcData = minecraftData(version);

      const tree = planner(mcData, 'wooden_sword', 1, {
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
      logger.debug(`HuntForFish: weapon planning error - ${err?.message || err}`);
      return null;
    }
  }

  async function captureWeaponSnapshotWithValidation(): Promise<any> {
    const inventory = getInventoryObject(bot);
    const inventoryMap = new Map(Object.entries(inventory));
    const version = bot.version || '1.20.1';
    const mcData = minecraftData(version);

    const validator = async (snapshot: any): Promise<boolean> => {
      try {
        const tree = planner(mcData, 'wooden_sword', 1, {
          inventory: new Map(inventoryMap),
          log: false,
          pruneWithWorld: true,
          combineSimilarNodes: true,
          worldSnapshot: snapshot
        });

        if (!tree) {
          logger.debug(`HuntForFish: weapon validator - no tree at radius ${snapshot.radius}`);
          return false;
        }

        const { enumerateActionPathsGenerator } = plannerInternals;
        const iter = enumerateActionPathsGenerator(tree, { inventory });

        for (const path of iter) {
          if (path && path.length > 0) {
            logger.debug(`HuntForFish: weapon validator - found valid path at radius ${snapshot.radius}`);
            return true;
          }
        }

        logger.debug(`HuntForFish: weapon validator - no paths at radius ${snapshot.radius}`);
        return false;
      } catch (err: any) {
        logger.debug(`HuntForFish: weapon validator error - ${err?.message || err}`);
        return false;
      }
    };

    try {
      logger.info(`HuntForFish: capturing weapon snapshot with radii ${JSON.stringify(WEAPON_SNAPSHOT_RADII)}`);
      const result = await captureAdaptiveSnapshot(bot, {
        radii: WEAPON_SNAPSHOT_RADII,
        validator,
        onProgress: (msg: string) => logger.debug(`HuntForFish: ${msg}`)
      });
      logger.info(`HuntForFish: weapon snapshot captured at radius ${result.radiusUsed} after ${result.attemptsCount} attempts`);
      return result.snapshot;
    } catch (err: any) {
      logger.info(`HuntForFish: weapon snapshot capture failed - ${err?.message || err}`);
      return null;
    }
  }

  async function generateWeaponPlan(): Promise<any[] | null> {
    const snapshot = await captureWeaponSnapshotWithValidation();
    if (!snapshot) return null;
    return tryPlanWeaponWithSnapshot(snapshot);
  }

  // Transitions

  const enterToFindAnimal = new StateTransition({
    parent: enter,
    child: findAnimal,
    name: 'HuntForFish: enter -> find fish',
    shouldTransition: () => true,
    onTransition: () => {
      phase = 'init';
      startFoodPoints = calculateCurrentFoodPoints();
      captureStartRawFishCounts();
      logger.info(`HuntForFish: starting, current food points = ${startFoodPoints}`);
    }
  });

  const findAnimalToPrepareWeapon = new StateTransition({
    parent: findAnimal,
    child: prepareWeapon,
    name: 'HuntForFish: find fish -> prepare weapon',
    shouldTransition: () => {
      const result = findClosestHuntableAnimal(bot, targets.animalFilter, HUNTABLE_WATER_ANIMALS);
      if (result) {
        huntedAnimalType = result.animalType;
        rawFishItem = getRawMeatDrop(result.animalType, HUNTABLE_WATER_ANIMALS);
        cookedFishItem = rawFishItem ? getCookedVariant(rawFishItem) : null;
        huntTargets.entity = result.entity;
        killPosition = result.entity.position?.clone?.() || { ...result.entity.position };
        return true;
      }
      return false;
    },
    onTransition: () => {
      logger.info(`HuntForFish: found ${huntedAnimalType}, preparing weapon before hunting for ${rawFishItem} -> ${cookedFishItem}`);
    }
  });

  const findAnimalToExit = new StateTransition({
    parent: findAnimal,
    child: exit,
    name: 'HuntForFish: find fish -> exit (no fish)',
    shouldTransition: () => {
      const result = findClosestHuntableAnimal(bot, targets.animalFilter, HUNTABLE_WATER_ANIMALS);
      return !result;
    },
    onTransition: () => {
      phase = 'failed';
      logger.info('HuntForFish: no huntable water animals found nearby');
    }
  });

  const prepareWeaponToHunting = new StateTransition({
    parent: prepareWeapon,
    child: huntStateMachine,
    name: 'HuntForFish: prepare weapon -> hunting',
    shouldTransition: () => {
      if (weaponPhase === 'skipped' || weaponPhase === 'done') return true;
      if (weaponPhase === 'executing' && weaponStateMachine && typeof weaponStateMachine.isFinished === 'function') {
        return weaponStateMachine.isFinished();
      }
      return false;
    },
    onTransition: () => {
      phase = 'hunting';
      logger.info(`HuntForFish: weapon ready, hunting ${huntedAnimalType}`);
    }
  });

  const huntingToSmelting = new StateTransition({
    parent: huntStateMachine,
    child: smelting,
    name: 'HuntForFish: hunting -> smelting (auto-collected)',
    shouldTransition: () => {
      const finished = typeof huntStateMachine.isFinished === 'function'
        ? huntStateMachine.isFinished()
        : false;
      if (!finished) return false;

      const gained = getFoodGained();
      return gained > 0;
    },
    onTransition: () => {
      const gained = getFoodGained();
      logger.info(`HuntForFish: hunt complete, gained ${gained} food points (auto-collected), proceeding to smelt`);
      setupSmelting();
    }
  });

  const huntingToFindDrop = new StateTransition({
    parent: huntStateMachine,
    child: findDrop,
    name: 'HuntForFish: hunting -> find drop',
    shouldTransition: () => {
      const finished = typeof huntStateMachine.isFinished === 'function'
        ? huntStateMachine.isFinished()
        : false;
      if (!finished) return false;

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
      logger.info('HuntForFish: hunt complete but no food gained yet, searching for drops');
    }
  });

  const findDropToGoToDrop = new StateTransition({
    parent: findDrop,
    child: goToDrop,
    name: 'HuntForFish: find drop -> go to drop',
    shouldTransition: () => {
      if (!dropTargets.entity) return false;
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
        logger.debug('HuntForFish: found drop, moving to collect');
        lastDropLogTime = now;
      }
    }
  });

  const findDropToSmelting = new StateTransition({
    parent: findDrop,
    child: smelting,
    name: 'HuntForFish: find drop -> smelting (no more drops)',
    shouldTransition: () => {
      if (dropTargets.entity === null || shouldStopDropCollection()) {
        return hasCollectedRawFish();
      }
      return false;
    },
    onTransition: () => {
      logger.info(`HuntForFish: no more drops found (attempts=${dropAttemptCount}), proceeding to smelt`);
      setupSmelting();
    }
  });

  const findDropToExit = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'HuntForFish: find drop -> exit (no drops, no fish)',
    shouldTransition: () => {
      if (dropTargets.entity === null || shouldStopDropCollection()) {
        return !hasCollectedRawFish();
      }
      return false;
    },
    onTransition: () => {
      phase = 'failed';
      logger.info(`HuntForFish: no drops found (attempts=${dropAttemptCount}) and no raw fish collected`);
    }
  });

  let reachedDropTime = 0;
  let waitingForPickup = false;

  const goToDropToFindDrop = new StateTransition({
    parent: goToDrop,
    child: findDrop,
    name: 'HuntForFish: go to drop -> find drop (collected, look for more)',
    shouldTransition: () => {
      const entityId = dropTargets.entity?.id;
      if (entityId === undefined) {
        if (!waitingForPickup) {
          waitingForPickup = true;
          reachedDropTime = Date.now();
          return false;
        }
        const waitTime = Date.now() - reachedDropTime;
        if (waitTime < DROP_PICKUP_WAIT_TIME) {
          return false;
        }
        logger.debug('HuntForFish: no valid drop entity, moving on');
        return true;
      }

      const dist = goToDrop.distanceToTarget?.() ?? 999;
      const closeEnough = dist <= 2.0;

      if (!closeEnough) {
        waitingForPickup = false;
        reachedDropTime = 0;
        return false;
      }

      if (!waitingForPickup) {
        waitingForPickup = true;
        reachedDropTime = Date.now();
        return false;
      }

      if (isDropCollectTimedOut(dropCollectStartTime, Date.now(), DROP_COLLECT_TIMEOUT)) return true;
      if (dropAttemptCount >= DROP_COLLECT_MAX_ATTEMPTS) return true;

      const entityStillExists = bot.entities && bot.entities[entityId];

      if (!entityStillExists) {
        logger.debug(`HuntForFish: picked up drop (entity ${entityId} despawned)`);
        return true;
      }

      const waitTime = Date.now() - reachedDropTime;
      if (waitTime >= DROP_PICKUP_WAIT_TIME) {
        logger.debug(`HuntForFish: drop pickup timeout after ${waitTime}ms, moving on`);
        return true;
      }

      return false;
    },
    onTransition: () => {
      dropAttemptCount++;
      waitingForPickup = false;
      reachedDropTime = 0;

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

  const goToDropToSmelting = new StateTransition({
    parent: goToDrop,
    child: smelting,
    name: 'HuntForFish: go to drop -> smelting (done collecting)',
    shouldTransition: () => {
      if (!shouldStopDropCollection()) return false;
      return hasCollectedRawFish();
    },
    onTransition: () => {
      logger.info(`HuntForFish: drop collection done (attempts=${dropAttemptCount}), proceeding to smelt`);
      setupSmelting();
    }
  });

  const goToDropToExit = new StateTransition({
    parent: goToDrop,
    child: exit,
    name: 'HuntForFish: go to drop -> exit (done, no fish)',
    shouldTransition: () => {
      if (!shouldStopDropCollection()) return false;
      return !hasCollectedRawFish();
    },
    onTransition: () => {
      phase = 'failed';
      logger.info(`HuntForFish: drop collection done (attempts=${dropAttemptCount}) with no raw fish collected`);
    }
  });

  function setupSmelting(): void {
    phase = 'smelting';
    const rawFish = countRawMeatInInventory(getInventoryObject(bot), HUNTABLE_WATER_ANIMALS);
    const toSmelt = rawFish[0];

    if (toSmelt) {
      const cookedItem = getCookedVariant(toSmelt.rawItem);
      const startCount = startRawFishCounts.get(toSmelt.rawItem) || 0;
      const collectedThisHunt = toSmelt.count - startCount;
      logger.info(`HuntForFish: have ${toSmelt.count}x ${toSmelt.rawItem} (collected ${collectedThisHunt} this hunt), smelting -> ${cookedItem}`);

      if (cookedItem) {
        const hasFurnace = getItemCountInInventory(bot, 'furnace') > 0;
        const hasCoal = getItemCountInInventory(bot, 'coal') > 0;

        if (hasFurnace && hasCoal) {
          smeltStateMachine = createSmeltState(bot, {
            itemName: cookedItem,
            amount: toSmelt.count,
            inputName: toSmelt.rawItem,
            fuelName: 'coal'
          });
        } else {
          logger.info(`HuntForFish: missing furnace or coal, skipping smelt (furnace=${hasFurnace}, coal=${hasCoal})`);
          phase = 'complete';
        }
      } else {
        phase = 'complete';
      }
    } else {
      phase = 'complete';
    }
  }

  const smeltingToExit = new StateTransition({
    parent: smelting,
    child: exit,
    name: 'HuntForFish: smelting -> exit',
    shouldTransition: () => {
      if (phase === 'complete' || phase === 'failed') return true;
      if (!smeltStateMachine) return true;
      const finished = typeof smeltStateMachine.isFinished === 'function'
        ? smeltStateMachine.isFinished()
        : false;
      return finished;
    },
    onTransition: () => {
      if (phase !== 'failed') phase = 'complete';
      const gained = getFoodGained();
      logger.info(`HuntForFish: complete, gained ${gained} food points`);
    }
  });

  const smeltingAsAny = smelting as any;
  const originalSmeltingEntered = smeltingAsAny.onStateEntered;
  smeltingAsAny.onStateEntered = function(this: any) {
    if (originalSmeltingEntered) originalSmeltingEntered.call(this);

    if (smeltStateMachine && typeof smeltStateMachine.onStateEntered === 'function') {
      logger.info('HuntForFish: starting smelt state machine');
      smeltStateMachine.onStateEntered();
    }
  };

  const transitions = [
    enterToFindAnimal,
    findAnimalToPrepareWeapon,
    findAnimalToExit,
    prepareWeaponToHunting,
    huntingToSmelting,
    huntingToFindDrop,
    findDropToGoToDrop,
    findDropToSmelting,
    findDropToExit,
    goToDropToFindDrop,
    goToDropToSmelting,
    goToDropToExit,
    smeltingToExit
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  const prepareWeaponAsAny = prepareWeapon as any;
  const originalPrepareWeaponEntered = prepareWeaponAsAny.onStateEntered;
  prepareWeaponAsAny.onStateEntered = async function(this: any) {
    if (originalPrepareWeaponEntered) originalPrepareWeaponEntered.call(this);

    weaponPhase = 'init';
    weaponPath = null;
    weaponStateMachine = null;

    if (hasSwordInInventory(getInventoryObject(bot))) {
      logger.info('HuntForFish: sword already in inventory, skipping weapon craft');
      weaponPhase = 'skipped';
      return;
    }

    weaponPhase = 'planning';
    logger.info('HuntForFish: no sword in inventory, attempting to craft wooden_sword');

    weaponPath = await generateWeaponPlan();

    if (weaponPath && weaponPath.length > 0) {
      weaponStateMachine = buildStateMachineForPath(bot, weaponPath, (success: boolean) => {
        weaponPhase = 'done';
        logger.info(`HuntForFish: wooden_sword ${success ? 'crafted' : 'craft failed'}, continuing hunt`);
        weaponStateMachine = null;
        weaponPath = null;
      });
      weaponPhase = 'executing';
      if (weaponStateMachine && typeof weaponStateMachine.onStateEntered === 'function') {
        logger.info('HuntForFish: starting weapon path sub-machine');
        weaponStateMachine.onStateEntered();
      }
    } else {
      logger.info('HuntForFish: no viable path for wooden_sword, continuing without weapon');
      weaponPhase = 'skipped';
    }
  };
  prepareWeaponAsAny.update = function() {
    const currentWeaponMachine = weaponStateMachine;
    if (currentWeaponMachine && typeof currentWeaponMachine.update === 'function') {
      currentWeaponMachine.update();
      if (typeof currentWeaponMachine.isFinished === 'function' && currentWeaponMachine.isFinished()) {
        weaponPhase = 'done';
        weaponStateMachine = null;
        weaponPath = null;
      }
    }
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
    logger.debug('HuntForFish: cleaning up');

    if (weaponStateMachine && typeof weaponStateMachine.onStateExited === 'function') {
      try { weaponStateMachine.onStateExited(); } catch (_) {}
    }
    if (huntStateMachine && typeof huntStateMachine.onStateExited === 'function') {
      try { huntStateMachine.onStateExited(); } catch (_) {}
    }
    if (smeltStateMachine && typeof smeltStateMachine.onStateExited === 'function') {
      try { smeltStateMachine.onStateExited(); } catch (_) {}
    }

    try { bot.clearControlStates?.(); } catch (_) {}
  };

  return stateMachine;
}

export default createHuntForFishState;
export { HuntForFishTargets };
