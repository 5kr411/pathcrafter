/**
 * BehaviorHuntForFood - Hunt animals and cook the meat
 * 
 * Orchestrates hunting any available animal, collecting dropped items,
 * then smelting the raw meat.
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
  HUNTABLE_ANIMALS,
  getCookedVariant,
  getFoodHungerPoints
} from '../utils/foodConfig';
import createHuntEntityState from './behaviorHuntEntity';
import createSmeltState from './behaviorSmelt';
import { BehaviorSafeFollowEntity } from './behaviorSafeFollowEntity';
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

interface HuntForFoodTargets {
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

/**
 * Finds the closest huntable animal from the bot's entity list
 */
function findClosestHuntableAnimal(bot: Bot, filter?: string[]): { entity: any; animalType: string } | null {
  if (!bot.entities || !bot.entity?.position) return null;
  
  const validAnimals = filter?.length 
    ? HUNTABLE_ANIMALS.filter(a => filter.includes(a.entity))
    : HUNTABLE_ANIMALS;
  
  const animalNames = new Set(validAnimals.map(a => a.entity));
  
  let closest: any = null;
  let closestDist = Infinity;
  let closestType = '';
  
  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position) continue;
    const name = (entity.name || '').toLowerCase();
    
    if (!animalNames.has(name)) continue;
    
    if (typeof entity.isAlive === 'function' && !entity.isAlive()) continue;
    if (typeof entity.health === 'number' && entity.health <= 0) continue;
    
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist < closestDist) {
      closest = entity;
      closestDist = dist;
      closestType = name;
    }
  }
  
  return closest ? { entity: closest, animalType: closestType } : null;
}

/**
 * Gets the raw meat drop for an animal type
 */
function getRawMeatDrop(animalType: string): string | null {
  const animal = HUNTABLE_ANIMALS.find(a => a.entity === animalType);
  return animal?.drops[0] || null;
}

/**
 * Counts raw meat items that can be cooked in inventory
 */
function countRawMeatInInventory(bot: Bot): { rawItem: string; count: number }[] {
  const inventory = getInventoryObject(bot);
  const rawMeats: { rawItem: string; count: number }[] = [];
  
  for (const animal of HUNTABLE_ANIMALS) {
    const rawItem = animal.drops[0];
    const count = inventory[rawItem] || 0;
    if (count > 0) {
      rawMeats.push({ rawItem, count });
    }
  }
  
  return rawMeats;
}

/**
 * Gets item info from a dropped item entity
 */
function getDroppedItemInfo(entity: any): { name: string | null; count: number } {
  // Check if entity has getDroppedItem method (mineflayer's way)
  if (typeof entity.getDroppedItem === 'function') {
    const item = entity.getDroppedItem();
    if (item) {
      return { name: item.name, count: item.count || 1 };
    }
  }
  
  // Fallback: check metadata for item data
  if (Array.isArray(entity.metadata)) {
    const itemMeta = entity.metadata[7] || entity.metadata[8];
    if (itemMeta && typeof itemMeta === 'object' && itemMeta.itemId !== undefined) {
      return {
        name: itemMeta.name || `item_${itemMeta.itemId}`,
        count: itemMeta.itemCount || 1
      };
    }
  }
  return { name: null, count: 0 };
}

function isActualDroppedItem(entity: any): boolean {
  // Primary check: mineflayer names dropped items 'item'
  if (entity.name === 'item') return true;
  
  // Secondary check: has getDroppedItem method and it returns something
  if (typeof entity.getDroppedItem === 'function' && entity.getDroppedItem()) return true;
  
  // Don't use broad checks like entity.type === 'object' or Array.isArray(entity.metadata)
  // These match mobs, XP orbs, and other non-item entities
  return false;
}

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
  let weaponPath: any[] | null = null;
  let weaponStateMachine: any = null;
  
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
  
  // Smelt state machine - created lazily
  let smeltStateMachine: any = null;
  
  const enter = new BehaviorIdle();
  const prepareWeapon = new BehaviorIdle();
  const findAnimal = new BehaviorIdle();
  const smelting = new BehaviorIdle();
  const exit = new BehaviorIdle();
  
  // Drop collection states
  const findDrop = new BehaviorGetClosestEntity(bot, dropTargets, (entity: any) => {
    const botPos = bot.entity?.position;
    if (!botPos || !entity.position?.distanceTo) return false;
    
    // Skip entities we've already attempted to collect
    if (entity.id && attemptedDropIds.has(entity.id)) return false;
    
    // Use strict check for dropped items - avoids matching mobs/XP orbs
    if (!isActualDroppedItem(entity)) return false;
    
    // Check if near kill position
    const distToKill = killPosition && entity.position.distanceTo 
      ? entity.position.distanceTo(killPosition) 
      : Number.POSITIVE_INFINITY;
    const nearKillPos = distToKill < DROP_COLLECT_RADIUS;
    const inBotRange = entity.position.distanceTo(botPos) < 16;
    
    if (nearKillPos && inBotRange) {
      const dropInfo = getDroppedItemInfo(entity);
      logger.debug(`HuntForFood: found drop near kill position: ${dropInfo.name} x${dropInfo.count}, dist=${distToKill.toFixed(2)}`);
      return true;
    }
    return false;
  });
  
  const goToDrop = new BehaviorSafeFollowEntity(bot, dropTargets);
  
  addStateLogging(enter, 'HuntForFood:Enter', { logEnter: true });
  addStateLogging(prepareWeapon, 'HuntForFood:PrepareWeapon', { logEnter: true });
  addStateLogging(findAnimal, 'HuntForFood:FindAnimal', { logEnter: true });
  addStateLogging(findDrop, 'HuntForFood:FindDrop', { logEnter: false });
  addStateLogging(goToDrop, 'HuntForFood:GoToDrop', { logEnter: false });
  addStateLogging(smelting, 'HuntForFood:Smelting', { logEnter: true });
  
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
    for (const animal of HUNTABLE_ANIMALS) {
      const rawItem = animal.drops[0];
      const count = getItemCountInInventory(bot, rawItem);
      startRawMeatCounts.set(rawItem, count);
    }
  }
  
  function getRawMeatGained(): number {
    let gained = 0;
    for (const animal of HUNTABLE_ANIMALS) {
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
  
  function getFoodGained(): number {
    const pointsGained = calculateCurrentFoodPoints() - startFoodPoints;
    const rawMeatGained = getRawMeatGained();
    // Return the higher of the two - sometimes food points don't capture raw meat correctly
    return Math.max(pointsGained, rawMeatGained);
  }

  function hasSwordInInventory(): boolean {
    const inventory = getInventoryObject(bot);
    return Object.entries(inventory).some(([name, count]) => {
      if (!name.endsWith('_sword')) return false;
      return (count || 0) > 0;
    });
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
      logger.debug(`HuntForFood: weapon planning error - ${err?.message || err}`);
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
          logger.debug(`HuntForFood: weapon validator - no tree at radius ${snapshot.radius}`);
          return false;
        }

        const { enumerateActionPathsGenerator } = plannerInternals;
        const iter = enumerateActionPathsGenerator(tree, { inventory });

        for (const path of iter) {
          if (path && path.length > 0) {
            logger.debug(`HuntForFood: weapon validator - found valid path at radius ${snapshot.radius}`);
            return true;
          }
        }

        logger.debug(`HuntForFood: weapon validator - no paths at radius ${snapshot.radius}`);
        return false;
      } catch (err: any) {
        logger.debug(`HuntForFood: weapon validator error - ${err?.message || err}`);
        return false;
      }
    };

    try {
      logger.info(`HuntForFood: capturing weapon snapshot with radii ${JSON.stringify(WEAPON_SNAPSHOT_RADII)}`);
      const result = await captureAdaptiveSnapshot(bot, {
        radii: WEAPON_SNAPSHOT_RADII,
        validator,
        onProgress: (msg: string) => logger.debug(`HuntForFood: ${msg}`)
      });
      logger.info(`HuntForFood: weapon snapshot captured at radius ${result.radiusUsed} after ${result.attemptsCount} attempts`);
      return result.snapshot;
    } catch (err: any) {
      logger.info(`HuntForFood: weapon snapshot capture failed - ${err?.message || err}`);
      return null;
    }
  }

  async function generateWeaponPlan(): Promise<any[] | null> {
    const snapshot = await captureWeaponSnapshotWithValidation();
    if (!snapshot) return null;
    return tryPlanWeaponWithSnapshot(snapshot);
  }
  
  function isDropCollectTimedOut(): boolean {
    return Date.now() - dropCollectStartTime > DROP_COLLECT_TIMEOUT;
  }
  
  // Transitions
  
  const enterToPrepareWeapon = new StateTransition({
    parent: enter,
    child: prepareWeapon,
    name: 'HuntForFood: enter -> prepare weapon',
    shouldTransition: () => true,
    onTransition: () => {
      phase = 'init';
      weaponPhase = 'init';
      weaponPath = null;
      weaponStateMachine = null;
      startFoodPoints = calculateCurrentFoodPoints();
      captureStartRawMeatCounts();
      logger.info(`HuntForFood: starting, current food points = ${startFoodPoints}`);
    }
  });

  const prepareWeaponToFindAnimal = new StateTransition({
    parent: prepareWeapon,
    child: findAnimal,
    name: 'HuntForFood: prepare weapon -> find animal',
    shouldTransition: () => {
      if (weaponPhase === 'skipped' || weaponPhase === 'done') return true;
      if (weaponPhase === 'executing' && weaponStateMachine && typeof weaponStateMachine.isFinished === 'function') {
        return weaponStateMachine.isFinished();
      }
      return false;
    }
  });
  
  const findAnimalToHunting = new StateTransition({
    parent: findAnimal,
    child: huntStateMachine,
    name: 'HuntForFood: find animal -> hunting',
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
      phase = 'hunting';
      logger.info(`HuntForFood: found ${huntedAnimalType}, hunting for ${rawMeatItem} -> ${cookedMeatItem}`);
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
  
  // If hunt finished AND we gained food points (drops auto-collected), skip drop collection
  const huntingToSmelting = new StateTransition({
    parent: huntStateMachine,
    child: smelting,
    name: 'HuntForFood: hunting -> smelting (auto-collected)',
    shouldTransition: () => {
      const finished = typeof huntStateMachine.isFinished === 'function' 
        ? huntStateMachine.isFinished() 
        : false;
      if (!finished) return false;
      
      // Check if food points increased (drops auto-collected)
      const gained = getFoodGained();
      return gained > 0;
    },
    onTransition: () => {
      const gained = getFoodGained();
      logger.info(`HuntForFood: hunt complete, gained ${gained} food points (auto-collected), proceeding to smelt`);
      setupSmelting();
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
  
  const findDropToSmelting = new StateTransition({
    parent: findDrop,
    child: smelting,
    name: 'HuntForFood: find drop -> smelting (no more drops)',
    shouldTransition: () => {
      // No drop found, timed out, or max attempts reached
      if (dropTargets.entity === null || shouldStopDropCollection()) {
        const rawMeats = countRawMeatInInventory(bot);
        return rawMeats.length > 0;
      }
      return false;
    },
    onTransition: () => {
      logger.info(`HuntForFood: no more drops found (attempts=${dropAttemptCount}), proceeding to smelt`);
      setupSmelting();
    }
  });
  
  const findDropToExit = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'HuntForFood: find drop -> exit (no drops, no meat)',
    shouldTransition: () => {
      if (dropTargets.entity === null || shouldStopDropCollection()) {
        const rawMeats = countRawMeatInInventory(bot);
        return rawMeats.length === 0;
      }
      return false;
    },
    onTransition: () => {
      phase = 'failed';
      logger.info(`HuntForFood: no drops found (attempts=${dropAttemptCount}) and no raw meat in inventory`);
    }
  });
  
  let reachedDropTime = 0;
  let waitingForPickup = false;
  
  const goToDropToFindDrop = new StateTransition({
    parent: goToDrop,
    child: findDrop,
    name: 'HuntForFood: go to drop -> find drop (collected, look for more)',
    shouldTransition: () => {
      // Check if entity is valid first - if not, wait a bit before transitioning
      const entityId = dropTargets.entity?.id;
      if (entityId === undefined) {
        // Entity was never valid or already cleared - need a cooldown to prevent spam
        if (!waitingForPickup) {
          waitingForPickup = true;
          reachedDropTime = Date.now();
          return false;
        }
        const waitTime = Date.now() - reachedDropTime;
        if (waitTime < DROP_PICKUP_WAIT_TIME) {
          return false;
        }
        logger.debug('HuntForFood: no valid drop entity, moving on');
        return true;
      }
      
      const dist = goToDrop.distanceToTarget?.() ?? 999;
      const closeEnough = dist <= 2.0;
      
      if (!closeEnough) {
        waitingForPickup = false;
        reachedDropTime = 0;
        return false;
      }
      
      // Start waiting for pickup when we first get close
      if (!waitingForPickup) {
        waitingForPickup = true;
        reachedDropTime = Date.now();
        return false;
      }
      
      if (isDropCollectTimedOut()) return true;
      if (dropAttemptCount >= DROP_COLLECT_MAX_ATTEMPTS) return true;
      
      // Check if the drop entity still exists (if it despawned, we picked it up)
      const entityStillExists = bot.entities && bot.entities[entityId];
      
      if (!entityStillExists) {
        // Entity despawned - we picked it up!
        logger.debug(`HuntForFood: picked up drop (entity ${entityId} despawned)`);
        return true;
      }
      
      // Wait for pickup, but don't wait forever
      const waitTime = Date.now() - reachedDropTime;
      if (waitTime >= DROP_PICKUP_WAIT_TIME) {
        // Waited long enough, entity didn't despawn - move on
        logger.debug(`HuntForFood: drop pickup timeout after ${waitTime}ms, moving on`);
        return true;
      }
      
      return false;
    },
    onTransition: () => {
      dropAttemptCount++;
      waitingForPickup = false;
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
    return isDropCollectTimedOut() || dropAttemptCount >= DROP_COLLECT_MAX_ATTEMPTS;
  }
  
  const goToDropToSmelting = new StateTransition({
    parent: goToDrop,
    child: smelting,
    name: 'HuntForFood: go to drop -> smelting (done collecting)',
    shouldTransition: () => {
      if (!shouldStopDropCollection()) return false;
      const rawMeats = countRawMeatInInventory(bot);
      return rawMeats.length > 0;
    },
    onTransition: () => {
      logger.info(`HuntForFood: drop collection done (attempts=${dropAttemptCount}), proceeding to smelt`);
      setupSmelting();
    }
  });
  
  const goToDropToExit = new StateTransition({
    parent: goToDrop,
    child: exit,
    name: 'HuntForFood: go to drop -> exit (done, no meat)',
    shouldTransition: () => {
      if (!shouldStopDropCollection()) return false;
      const rawMeats = countRawMeatInInventory(bot);
      return rawMeats.length === 0;
    },
    onTransition: () => {
      phase = 'failed';
      logger.info(`HuntForFood: drop collection done (attempts=${dropAttemptCount}) with no raw meat`);
    }
  });
  
  function setupSmelting(): void {
    phase = 'smelting';
    const rawMeats = countRawMeatInInventory(bot);
    const toSmelt = rawMeats[0];
    
    if (toSmelt) {
      const cookedItem = getCookedVariant(toSmelt.rawItem);
      const startCount = startRawMeatCounts.get(toSmelt.rawItem) || 0;
      const collectedThisHunt = toSmelt.count - startCount;
      logger.info(`HuntForFood: have ${toSmelt.count}x ${toSmelt.rawItem} (collected ${collectedThisHunt} this hunt), smelting -> ${cookedItem}`);
      
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
          logger.info(`HuntForFood: missing furnace or coal, skipping smelt (furnace=${hasFurnace}, coal=${hasCoal})`);
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
    name: 'HuntForFood: smelting -> exit',
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
      logger.info(`HuntForFood: complete, gained ${gained} food points`);
    }
  });
  
  // Hook into smelting state to start the smelt state machine
  const smeltingAsAny = smelting as any;
  const originalSmeltingEntered = smeltingAsAny.onStateEntered;
  smeltingAsAny.onStateEntered = function(this: any) {
    if (originalSmeltingEntered) originalSmeltingEntered.call(this);
    
    if (smeltStateMachine && typeof smeltStateMachine.onStateEntered === 'function') {
      logger.info('HuntForFood: starting smelt state machine');
      smeltStateMachine.onStateEntered();
    }
  };
  
  const transitions = [
    enterToPrepareWeapon,
    prepareWeaponToFindAnimal,
    findAnimalToHunting,
    findAnimalToExit,
    huntingToSmelting,  // Fast path: drops auto-collected
    huntingToFindDrop,  // Slow path: need to find drops
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

    if (hasSwordInInventory()) {
      logger.info('HuntForFood: sword already in inventory, skipping weapon craft');
      weaponPhase = 'skipped';
      return;
    }

    weaponPhase = 'planning';
    logger.info('HuntForFood: no sword in inventory, attempting to craft wooden_sword');

    weaponPath = await generateWeaponPlan();

    if (weaponPath && weaponPath.length > 0) {
      weaponStateMachine = buildStateMachineForPath(bot, weaponPath, (success: boolean) => {
        weaponPhase = 'done';
        logger.info(`HuntForFood: wooden_sword ${success ? 'crafted' : 'craft failed'}, continuing hunt`);
        weaponStateMachine = null;
        weaponPath = null;
      });
      weaponPhase = 'executing';
      if (weaponStateMachine && typeof weaponStateMachine.onStateEntered === 'function') {
        logger.info('HuntForFood: starting weapon path sub-machine');
        weaponStateMachine.onStateEntered();
      }
    } else {
      logger.info('HuntForFood: no viable path for wooden_sword, continuing without weapon');
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
    logger.debug('HuntForFood: cleaning up');

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

export default createHuntForFoodState;
export { HuntForFoodTargets };
