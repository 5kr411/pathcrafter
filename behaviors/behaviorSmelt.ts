const { StateTransition, BehaviorIdle, NestedStateMachine, BehaviorEquipItem, BehaviorGetClosestEntity, BehaviorFollowEntity } = require('mineflayer-statemachine');

const minecraftData = require('minecraft-data');
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';
const { getSmeltsPerUnitForFuel } = require('../utils/smeltingConfig');
import { getItemCountInInventory } from '../utils/inventory';
import createPlaceNearState from './behaviorPlaceNear';
import createBreakAtPositionState from './behaviorBreakAtPosition';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  clone: () => Vec3Like;
  [key: string]: any;
}

interface Block {
  name?: string;
  [key: string]: any;
}

type Bot = any;

interface Targets {
  itemName: string;
  amount?: number;
  inputName: string;
  fuelName?: string;
  [key: string]: any;
}

function createSmeltState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const findFurnace = new BehaviorIdle();
  const equipFurnace = new BehaviorEquipItem(bot, { item: null });

  // Add logging to EquipItem
  addStateLogging(equipFurnace, 'EquipItem', {
    logEnter: true,
    getExtraInfo: () => {
      const item = equipFurnace.targets?.item;
      return item ? `equipping ${item.name} for smelting` : 'equipping furnace';
    }
  });

  const placeFurnaceTargets: { item: any; placedPosition?: Vec3Like; placedConfirmed?: boolean } = { item: null };
  let placeFurnace: any;
  try {
    placeFurnace = createPlaceNearState(bot, placeFurnaceTargets as any);
  } catch (_) {
    placeFurnace = { isFinished: () => true };
  }
  const smeltRun = new BehaviorIdle();
  const breakTargets: { position: Vec3Like | null } = { position: null };
  const breakFurnace = createBreakAtPositionState(bot, breakTargets as any);
  
  const COLLECT_TIMEOUT_MS = 7000;
  const MAX_COLLECT_RETRIES = 2;
  const FOLLOW_TIMEOUT_MS = 7000;
  const MAX_FOLLOW_RETRIES = 2;
  
  const dropTargets: { entity: any } = { entity: null };
  const getDrop = new BehaviorGetClosestEntity(bot, dropTargets, (e: any) => 
    e.name === 'item' && e.getDroppedItem && e.getDroppedItem()?.name === 'furnace'
  );
  addStateLogging(getDrop, 'GetClosestEntity', { logEnter: true, getExtraInfo: () => 'looking for dropped furnace' });
  
  const followDrop = new BehaviorFollowEntity(bot, dropTargets);
  addStateLogging(followDrop, 'FollowEntity', {
    logEnter: true,
    getExtraInfo: () => {
      if (dropTargets.entity) {
        const pos = dropTargets.entity.position;
        return `following dropped furnace at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), distance: ${bot.entity?.position?.distanceTo?.(pos)?.toFixed(2) || 'n/a'}m`;
      }
      return 'no entity';
    }
  });
  
  let collectStartTime: number = 0;
  let followStartTime: number = 0;
  let collectRetryCount = 0;
  let followRetryCount = 0;
  
  const exit = new BehaviorIdle();

  function getMc(): any {
    try {
      return minecraftData(bot.version);
    } catch (_) {
      return minecraftData('1.20.1');
    }
  }

  function getItemCount(name: string): number {
    try {
      let c = 0;
      const items = bot.inventory?.items?.() || [];
      for (const it of items) if (it && it.name === name) c += it.count || 0;
      return c;
    } catch (_) {
      return 0;
    }
  }

  function findNearbyFurnace(maxDistance: number = 6): Block | null {
    try {
      const ids = ['furnace', 'lit_furnace']
        .filter((n) => bot.registry.blocksByName[n] !== undefined)
        .map((n) => bot.registry.blocksByName[n].id);
      // Use safe finder if available to avoid repeating unreachable furnaces
      if (typeof bot.findBlocks === 'function') {
        const list = bot.findBlocks({ matching: ids, maxDistance, count: 8 }) || [];
        for (const p of list) {
          try {
            const b = bot.blockAt(p, false);
            if (b && (b.name === 'furnace' || b.name === 'lit_furnace')) return b;
          } catch (_) {}
        }
        return null;
      }
      return bot.findBlock?.({ matching: ids, maxDistance }) || null;
    } catch (_) {
      return null;
    }
  }

  let wantItem: string;
  let wantCount: number;
  let inputItem: string;
  let fuelItem: string;
  let furnaceCountBeforeBreak = 0;
  const initToFind = new StateTransition({
    name: 'Smelt: enter -> find',
    parent: enter,
    child: findFurnace,
    shouldTransition: () => true,
    onTransition: () => {
      wantItem = targets.itemName;
      wantCount = Number(targets.amount || 1);
      inputItem = targets.inputName;
      fuelItem = targets.fuelName || 'coal';
      logger.info(`enter -> find (want ${wantCount} ${wantItem}, input=${inputItem}, fuel=${fuelItem})`);
    }
  });

  let foundFurnace: Block | null = null;
  let placedByUs = false;
  const findToEquip = new StateTransition({
    name: 'Smelt: find -> equip furnace',
    parent: findFurnace,
    child: equipFurnace,
    shouldTransition: () => {
      foundFurnace = findNearbyFurnace(6);
      if (foundFurnace) return false;
      try {
        equipFurnace.targets.item =
          bot.inventory?.items?.().find((it: any) => it && it.name === 'furnace') || null;
      } catch (_) {}
      return !!equipFurnace.targets.item;
    },
    onTransition: () => {
      placedByUs = true;
      logger.debug('find -> equip furnace (no furnace nearby)');
    }
  });

  const findToSmelt = new StateTransition({
    name: 'Smelt: find -> run (already placed)',
    parent: findFurnace,
    child: smeltRun,
    shouldTransition: () => {
      foundFurnace = findNearbyFurnace(6);
      return !!foundFurnace;
    },
    onTransition: () => {
      placedByUs = false;
      logger.debug('find -> run (using existing furnace)');
    }
  });

  const findToExit = new StateTransition({
    name: 'Smelt: find -> exit (no furnace available)',
    parent: findFurnace,
    child: exit,
    shouldTransition: () => {
      foundFurnace = findNearbyFurnace(6);
      if (foundFurnace) return false;
      
      try {
        const hasFurnaceInInventory = bot.inventory?.items?.().some((it: any) => it && it.name === 'furnace');
        return !hasFurnaceInInventory;
      } catch (_) {
        return true;
      }
    },
    onTransition: () => {
      logger.error('find -> exit (no furnace available - cannot smelt without furnace)');
    }
  });

  const equipToPlace = new StateTransition({
    name: 'Smelt: equip -> place',
    parent: equipFurnace,
    child: placeFurnace,
    shouldTransition: () =>
      (typeof equipFurnace.isFinished === 'function' ? equipFurnace.isFinished() : true) &&
      !!equipFurnace.targets.item,
    onTransition: () => {
      placeFurnaceTargets.item = equipFurnace.targets.item;
      logger.debug('equip -> place furnace');
    }
  });

  const placeToSmelt = new StateTransition({
    name: 'Smelt: place -> run',
    parent: placeFurnace,
    child: smeltRun,
    shouldTransition: () => {
      if (typeof placeFurnace.isFinished !== 'function') return true;
      if (!placeFurnace.isFinished()) return false;
      // Only transition to run if placement was confirmed successful
      return !!placeFurnaceTargets.placedConfirmed;
    },
    onTransition: () => {
      try {
        if (placeFurnaceTargets && placeFurnaceTargets.placedPosition) {
          breakTargets.position = placeFurnaceTargets.placedPosition.clone();
          if (placeFurnaceTargets.placedConfirmed) placedByUs = true;
          logger.debug('place -> run (placed furnace at)', breakTargets.position);
        }
      } catch (_) {}
    }
  });
  
  // Exit if placement failed
  const placeToExit = new StateTransition({
    name: 'Smelt: place -> exit',
    parent: placeFurnace,
    child: exit,
    shouldTransition: () => {
      if (typeof placeFurnace.isFinished !== 'function') return false;
      if (!placeFurnace.isFinished()) return false;
      // Exit if placement finished but was not confirmed
      return !placeFurnaceTargets.placedConfirmed;
    },
    onTransition: () => {
      logger.error('Smelt: place -> exit (placement failed or timed out)');
    }
  });

  let smeltDone = false;
  let smeltSucceeded = false;
  let breakRecommended = false;
  smeltRun.onStateEntered = async () => {
    try {
      const mc = getMc();
      let furnaceBlock: Block | null = null;
      try {
        if (breakTargets && breakTargets.position) {
          const maybe = bot.blockAt(breakTargets.position, false);
          if (maybe && (maybe.name === 'furnace' || maybe.name === 'lit_furnace')) furnaceBlock = maybe;
        }
      } catch (_) {}
      if (!furnaceBlock) furnaceBlock = findNearbyFurnace(6);
      if (!furnaceBlock) return;
      const furnace = await bot.openFurnace(furnaceBlock);
      const have0 = getItemCountInInventory(bot, wantItem);
      const outTarget = have0 + Math.max(1, wantCount);
      logger.info(`run start (have ${have0} ${wantItem}, target ${outTarget})`);
      function idOf(name: string): number | undefined {
        return mc.itemsByName[name]?.id;
      }
      function sleep(ms: number): Promise<void> {
        return new Promise((r) => setTimeout(r, ms));
      }
      let lastProgress = 0;
      let prevOut = have0;
      let lastActivity = Date.now();
      let lastFuelPut = 0;
      const STALL_TIMEOUT_MS = 20000;
      // Track fuel locally to avoid duplicate top-ups due to delayed window updates
      let localFuelCount = furnace.fuelItem() ? furnace.fuelItem()!.count || 0 : 0;
      let localOutputTaken = 0;
      while (Date.now() - lastActivity < STALL_TIMEOUT_MS) {
        const invDelta = Math.max(0, getItemCount(wantItem) - have0);
        const produced = Math.max(invDelta, localOutputTaken);
        if (have0 + produced >= outTarget) break;
        let acted = false;
        try {
          if (inputItem && getItemCount(inputItem) > 0 && !furnace.inputItem()) {
            const toPut = Math.min(getItemCount(inputItem), Math.max(1, outTarget - (have0 + produced)));
            await furnace.putInput(idOf(inputItem)!, null, toPut);
            logger.debug(`put input x${toPut} ${inputItem}`);
            acted = true;
          }
        } catch (_) {}
        try {
          if (fuelItem && getItemCount(fuelItem) > 0) {
            const perUnit = Math.max(1, getSmeltsPerUnitForFuel(fuelItem) || 0);
            const remaining = Math.max(0, outTarget - (have0 + produced));
            const desiredUnits = Math.ceil(remaining / perUnit);
            // Sync local fuel count from furnace when available
            const fuelSlot = furnace.fuelItem();
            const currentUnits = fuelSlot ? fuelSlot.count || 0 : localFuelCount;
            localFuelCount = currentUnits;
            const available = getItemCount(fuelItem);
            const topUp = Math.max(0, Math.min(available, desiredUnits - currentUnits));
            const now = Date.now();
            if (topUp > 0 && now - lastFuelPut > 800) {
              await furnace.putFuel(idOf(fuelItem)!, null, topUp);
              localFuelCount += topUp;
              lastFuelPut = now;
              logger.debug(`put fuel x${topUp} ${fuelItem} (perUnit=${perUnit})`);
              acted = true;
            }
          }
        } catch (_) {}
        try {
          if (furnace.outputItem()) {
            const outStack = furnace.outputItem();
            const stackCount = outStack ? outStack.count || 0 : 0;
            await furnace.takeOutput();
            localOutputTaken += stackCount > 0 ? stackCount : 1;
            const beforeWaitHave = getItemCountInInventory(bot, wantItem);
            let waited = 0;
            while (waited < 600 && getItemCountInInventory(bot, wantItem) === beforeWaitHave) {
              await sleep(50);
              waited += 50;
            }
            const estHave = have0 + Math.max(localOutputTaken, Math.max(0, getItemCountInInventory(bot, wantItem) - have0));
            logger.debug(`took output (have ~${estHave}/${outTarget})`);
            acted = true;
          }
        } catch (_) {}
        const prog = Number.isFinite(furnace.progress) ? furnace.progress : 0;
        const curOut = getItemCountInInventory(bot, wantItem);
        if (curOut > prevOut) {
          lastActivity = Date.now();
          prevOut = curOut;
        }
        if (acted || prog > lastProgress || furnace.inputItem() || furnace.outputItem()) {
          lastActivity = Date.now();
        }
        lastProgress = prog;
        await sleep(400);
      }
      const finalInvDelta = Math.max(0, getItemCountInInventory(bot, wantItem) - have0);
      const finalProduced = Math.max(finalInvDelta, localOutputTaken);
      smeltSucceeded = have0 + finalProduced >= outTarget;
      const preIn = furnace.inputItem();
      const preOut = furnace.outputItem();
      const invInputCount = inputItem ? getItemCountInInventory(bot, inputItem) : 0;
      const furnaceInputCount = preIn ? preIn.count || 0 : 0;
      const noInputInInv = !inputItem || invInputCount + furnaceInputCount === 0;
      const noFuelInInv = !fuelItem || getItemCountInInventory(bot, fuelItem) === 0;
      const furnaceIdle = !preIn && !preOut;
      // Break if: target reached, or we have no input left, or furnace is idle and we have no fuel left
      breakRecommended = placedByUs && (smeltSucceeded || noInputInInv || (furnaceIdle && noFuelInInv));
      try {
        furnace.close();
      } catch (_) {}
      const stalled = !smeltSucceeded;
      const finalHave = getItemCountInInventory(bot, wantItem);
      const finalEst = have0 + finalProduced;
      logger.info(
        `run end (success=${smeltSucceeded}, stalled=${stalled}, have ${finalHave}/${outTarget}, est ${finalEst}/${outTarget})`
      );
    } catch (err) {
      logger.error('error during smelt run', err);
      // Break even on error if we placed the furnace
      breakRecommended = placedByUs || breakRecommended;
    } finally {
      smeltDone = true;
    }
  };

  const runToBreak = new StateTransition({
    name: 'Smelt: run -> break',
    parent: smeltRun,
    child: breakFurnace,
    shouldTransition: () => smeltDone && breakRecommended,
    onTransition: () => {
      furnaceCountBeforeBreak = getItemCountInInventory(bot, 'furnace');
      logger.debug(`run -> break (we placed furnace), have ${furnaceCountBeforeBreak} furnaces before break`);
    }
  });

  // Fallback: If we reached run but no furnace is present nearby, and we have a
  // furnace item in inventory, go equip/place and then resume.
  const runToEquipFallback = new StateTransition({
    name: 'Smelt: run -> equip (fallback, no nearby furnace)',
    parent: smeltRun,
    child: equipFurnace,
    shouldTransition: () => {
      const nearby = findNearbyFurnace(6);
      if (nearby) return false;
      try {
        equipFurnace.targets.item =
          bot.inventory?.items?.().find((it: any) => it && it.name === 'furnace') || null;
      } catch (_) {
        equipFurnace.targets.item = null;
      }
      return !!equipFurnace.targets.item;
    },
    onTransition: () => {
      placedByUs = true;
      logger.warn('Smelt: fallback to equip furnace (no furnace nearby during run)');
    }
  });

  const breakToExitIfPickedUp = new StateTransition({
    name: 'Smelt: break -> exit (already picked up)',
    parent: breakFurnace,
    child: exit,
    shouldTransition: () => {
      if (!breakFurnace.isFinished()) return false;
      const currentCount = getItemCountInInventory(bot, 'furnace');
      return currentCount > furnaceCountBeforeBreak;
    },
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'furnace');
      logger.info(`Smelt: break -> exit (already picked up: ${furnaceCountBeforeBreak} -> ${currentCount})`);
    }
  });
  
  const breakToGetDrop = new StateTransition({
    name: 'Smelt: break -> get drop',
    parent: breakFurnace,
    child: getDrop,
    shouldTransition: () => breakFurnace.isFinished(),
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'furnace');
      logger.info(`Smelt: break -> get drop (had ${furnaceCountBeforeBreak} furnaces before break, now have ${currentCount})`);
      collectStartTime = Date.now();
      collectRetryCount = 0;
    }
  });
  
  const getDropToExitIfPickedUp = new StateTransition({
    name: 'Smelt: get drop -> exit (picked up)',
    parent: getDrop,
    child: exit,
    shouldTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'furnace');
      return currentCount > furnaceCountBeforeBreak;
    },
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'furnace');
      logger.info(`Smelt: get drop -> exit (picked up: ${furnaceCountBeforeBreak} -> ${currentCount})`);
    }
  });
  
  const getDropToFollowDrop = new StateTransition({
    name: 'Smelt: get drop -> follow drop',
    parent: getDrop,
    child: followDrop,
    shouldTransition: () => {
      const elapsed = Date.now() - collectStartTime;
      if (elapsed > COLLECT_TIMEOUT_MS) return false;
      return !!dropTargets.entity;
    },
    onTransition: () => {
      const entity = dropTargets.entity;
      if (entity && entity.position) {
        logger.info(
          `Smelt: get drop -> follow drop (x=${entity.position.x}, y=${entity.position.y}, z=${entity.position.z})`
        );
        followStartTime = Date.now();
        followRetryCount = 0;
      }
    }
  });
  
  const getDropRetry = new StateTransition({
    name: 'Smelt: get drop -> get drop (retry)',
    parent: getDrop,
    child: getDrop,
    shouldTransition: () => {
      const elapsed = Date.now() - collectStartTime;
      const timedOut = elapsed > COLLECT_TIMEOUT_MS;
      return timedOut && !dropTargets.entity && collectRetryCount < MAX_COLLECT_RETRIES;
    },
    onTransition: () => {
      collectRetryCount++;
      logger.info(`Smelt: get drop -> get drop (retry ${collectRetryCount}/${MAX_COLLECT_RETRIES})`);
      collectStartTime = Date.now();
    }
  });
  
  const getDropToExit = new StateTransition({
    name: 'Smelt: get drop -> exit (timeout)',
    parent: getDrop,
    child: exit,
    shouldTransition: () => {
      const elapsed = Date.now() - collectStartTime;
      const timedOut = elapsed > COLLECT_TIMEOUT_MS;
      return timedOut && collectRetryCount >= MAX_COLLECT_RETRIES;
    },
    onTransition: () => {
      logger.info(`Smelt: get drop -> exit (timeout after ${MAX_COLLECT_RETRIES} retries)`);
    }
  });
  
  const followDropToExitIfPickedUp = new StateTransition({
    name: 'Smelt: follow drop -> exit (picked up)',
    parent: followDrop,
    child: exit,
    shouldTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'furnace');
      return currentCount > furnaceCountBeforeBreak;
    },
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'furnace');
      logger.info(`Smelt: follow drop -> exit (picked up: ${furnaceCountBeforeBreak} -> ${currentCount})`);
    }
  });
  
  const followDropRetry = new StateTransition({
    name: 'Smelt: follow drop -> get drop (retry)',
    parent: followDrop,
    child: getDrop,
    shouldTransition: () => {
      const elapsed = Date.now() - followStartTime;
      const timedOut = elapsed > FOLLOW_TIMEOUT_MS;
      return timedOut && followRetryCount < MAX_FOLLOW_RETRIES;
    },
    onTransition: () => {
      followRetryCount++;
      logger.info(`Smelt: follow drop -> get drop (retry ${followRetryCount}/${MAX_FOLLOW_RETRIES})`);
      collectStartTime = Date.now();
    }
  });
  
  const followDropToExit = new StateTransition({
    name: 'Smelt: follow drop -> exit (timeout)',
    parent: followDrop,
    child: exit,
    shouldTransition: () => {
      const elapsed = Date.now() - followStartTime;
      const timedOut = elapsed > FOLLOW_TIMEOUT_MS;
      return timedOut && followRetryCount >= MAX_FOLLOW_RETRIES;
    },
    onTransition: () => {
      logger.info(`Smelt: follow drop -> exit (timeout after ${MAX_FOLLOW_RETRIES} retries)`);
    }
  });
  
  let closeToDropSince: number = 0;
  const PICKUP_WAIT_MS = 1000;
  const PICKUP_RANGE = 0.5;
  
  const followDropToExit2 = new StateTransition({
    name: 'Smelt: follow drop -> exit (collected)',
    parent: followDrop,
    child: exit,
    shouldTransition: () => {
      if (!dropTargets.entity) {
        const currentCount = getItemCountInInventory(bot, 'furnace');
        const pickedUp = currentCount > furnaceCountBeforeBreak;
        if (pickedUp) {
          logger.info(`Smelt: entity disappeared but we picked it up (${furnaceCountBeforeBreak} -> ${currentCount})`);
          return true;
        }
        logger.warn('Smelt: entity disappeared but inventory did not increase');
        return false;
      }
      
      const elapsed = Date.now() - followStartTime;
      if (elapsed > FOLLOW_TIMEOUT_MS) return false;
      
      const entity = dropTargets.entity;
      if (!entity || !entity.position) return false;
      
      const dist = bot.entity?.position?.distanceTo?.(entity.position);
      if (dist == null) return false;
      
      if (dist < PICKUP_RANGE) {
        if (closeToDropSince === 0) {
          closeToDropSince = Date.now();
          logger.debug(`Smelt: within pickup range (${dist.toFixed(2)}m), waiting for auto-pickup`);
        }
        
        const waitedEnough = Date.now() - closeToDropSince >= PICKUP_WAIT_MS;
        if (waitedEnough) {
          const currentCount = getItemCountInInventory(bot, 'furnace');
          const pickedUp = currentCount > furnaceCountBeforeBreak;
          if (pickedUp) {
            logger.info(`Smelt: picked up furnace after waiting (${furnaceCountBeforeBreak} -> ${currentCount})`);
            return true;
          }
          logger.warn(`Smelt: within range for ${PICKUP_WAIT_MS}ms but inventory did not increase`);
        }
      } else {
        closeToDropSince = 0;
      }
      
      return false;
    },
    onTransition: () => {
      closeToDropSince = 0;
      logger.info('Smelt: follow drop -> exit (collected)');
    }
  });

  const runToExit = new StateTransition({
    name: 'Smelt: run -> exit (no break)',
    parent: smeltRun,
    child: exit,
    shouldTransition: () => smeltDone && !breakRecommended,
    onTransition: () => {
      logger.debug('run -> exit (did not place furnace)');
    }
  });

  return new NestedStateMachine(
    [
      initToFind,
      findToSmelt,
      findToEquip,
      findToExit,
      equipToPlace,
      placeToSmelt,
      placeToExit,
      runToEquipFallback,
      runToBreak,
      breakToExitIfPickedUp,
      breakToGetDrop,
      getDropToExitIfPickedUp,
      getDropToFollowDrop,
      getDropRetry,
      getDropToExit,
      followDropToExitIfPickedUp,
      followDropRetry,
      followDropToExit,
      followDropToExit2,
      runToExit
    ],
    enter,
    exit
  );
}

export default createSmeltState;

