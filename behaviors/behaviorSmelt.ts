const { StateTransition, BehaviorIdle, NestedStateMachine, BehaviorGetClosestEntity, BehaviorFollowEntity } = require('mineflayer-statemachine');
const minecraftData = require('minecraft-data');

import logger from '../utils/logger';
const { getSmeltsPerUnitForFuel } = require('../utils/smeltingConfig');
import { getItemCountInInventory } from '../utils/inventory';
import createPlaceNearState from './behaviorPlaceNear';
import createBreakAtPositionState from './behaviorBreakAtPosition';

type Bot = any;

interface Targets {
  itemName: string;
  amount?: number;
  inputName: string;
  fuelName?: string;
  [key: string]: any;
}

function createSmeltState(bot: Bot, targets: Targets): any {
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

  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();

  const placeTargets: { item: any; placedPosition?: any; placedConfirmed?: boolean } = {
    item: null,
    placedPosition: undefined,
    placedConfirmed: false
  };
  const placeFurnace = createPlaceNearState(bot, placeTargets);

  const smeltRun = new BehaviorIdle();

  const breakTargets: { position: any } = { position: null };
  const breakFurnace = createBreakAtPositionState(bot, breakTargets);

  const waitForPickup = new BehaviorIdle();

  const dropTargets: { entity: any } = { entity: null };
  const findDrop = new BehaviorGetClosestEntity(bot, dropTargets, (e: any) =>
    e.name === 'item' && e.getDroppedItem && e.getDroppedItem()?.name === 'furnace'
  );
  const followDrop = new BehaviorFollowEntity(bot, dropTargets);

  let wantItem: string;
  let wantCount: number;
  let inputItem: string;
  let fuelItem: string;
  let smeltDone = false;
  let furnaceCountBeforeBreak = 0;
  let waitStartTime = 0;

  const hasPickedUpFurnace = () => getItemCountInInventory(bot, 'furnace') > furnaceCountBeforeBreak;

  // enter -> exit (invalid)
  const enterToExit = new StateTransition({
    parent: enter,
    child: exit,
    name: 'Smelt: enter -> exit (invalid)',
    shouldTransition: () => !targets.itemName || !targets.inputName,
    onTransition: () => logger.error('Smelt: Missing itemName or inputName')
  });

  // enter -> place
  const enterToPlace = new StateTransition({
    parent: enter,
    child: placeFurnace,
    name: 'Smelt: enter -> place',
    shouldTransition: () => !!targets.itemName && !!targets.inputName,
    onTransition: () => {
      wantItem = targets.itemName;
      wantCount = Number(targets.amount || 1);
      inputItem = targets.inputName;
      fuelItem = targets.fuelName || 'coal';
      placeTargets.item = bot.inventory.items().find((i: any) => i?.name === 'furnace') || null;
      placeTargets.placedPosition = undefined;
      placeTargets.placedConfirmed = false;
      logger.info(`Smelt: Placing furnace to smelt ${wantCount} ${wantItem} from ${inputItem}`);
    }
  });

  // place -> exit (failed)
  const placeToExitFailed = new StateTransition({
    parent: placeFurnace,
    child: exit,
    name: 'Smelt: place -> exit (failed)',
    shouldTransition: () => {
      if (typeof placeFurnace.isFinished !== 'function') return false;
      return placeFurnace.isFinished() && !placeTargets.placedConfirmed;
    },
    onTransition: () => logger.error('Smelt: Failed to place furnace')
  });

  // place -> smelt
  const placeToSmelt = new StateTransition({
    parent: placeFurnace,
    child: smeltRun,
    name: 'Smelt: place -> smelt',
    shouldTransition: () => {
      if (typeof placeFurnace.isFinished !== 'function') return false;
      return placeFurnace.isFinished() && !!placeTargets.placedConfirmed;
    },
    onTransition: () => {
      smeltDone = false;
      breakTargets.position = placeTargets.placedPosition;
      logger.info('Smelt: Furnace placed, starting smelt');
    }
  });

  smeltRun.onStateEntered = async () => {
    try {
      const mc = getMc();
      const furnaceBlock = placeTargets.placedPosition ? bot.blockAt(placeTargets.placedPosition, false) : null;
      if (!furnaceBlock) {
        logger.error('Smelt: Could not find placed furnace');
        smeltDone = true;
        return;
      }

      const have0 = getItemCountInInventory(bot, wantItem);
      const outTarget = have0 + Math.max(1, wantCount);

      const haveInput = getItemCount(inputItem);
      const haveFuel = getItemCount(fuelItem);
      logger.info(`Smelt: Starting (have ${have0} ${wantItem}, target ${outTarget}, input: ${haveInput} ${inputItem}, fuel: ${haveFuel} ${fuelItem})`);

      if (haveInput === 0) {
        logger.error(`Smelt: No input material (${inputItem}) in inventory`);
        smeltDone = true;
        return;
      }

      if (haveFuel === 0) {
        logger.error(`Smelt: No fuel (${fuelItem}) in inventory`);
        smeltDone = true;
        return;
      }

      const furnace = await bot.openFurnace(furnaceBlock);

      const idOf = (name: string): number | undefined => mc.itemsByName[name]?.id;
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

      let lastProgress = 0;
      let prevOut = have0;
      let lastActivity = Date.now();
      let lastFuelPut = 0;
      const STALL_TIMEOUT_MS = 20000;
      let localFuelCount = furnace.fuelItem() ? furnace.fuelItem()!.count || 0 : 0;
      let localOutputTaken = 0;

      while (Date.now() - lastActivity < STALL_TIMEOUT_MS) {
        const invDelta = Math.max(0, getItemCount(wantItem) - have0);
        const produced = Math.max(invDelta, localOutputTaken);
        if (have0 + produced >= outTarget) break;

        let acted = false;

        try {
          if (getItemCount(inputItem) > 0 && !furnace.inputItem()) {
            const toPut = Math.min(getItemCount(inputItem), Math.max(1, outTarget - (have0 + produced)));
            await furnace.putInput(idOf(inputItem)!, null, toPut);
            logger.debug(`Smelt: put input x${toPut} ${inputItem}`);
            acted = true;
          }
        } catch (err) {
          logger.warn(`Smelt: Failed to put input: ${err}`);
        }

        try {
          if (getItemCount(fuelItem) > 0) {
            const perUnit = Math.max(1, getSmeltsPerUnitForFuel(fuelItem) || 0);
            const remaining = Math.max(0, outTarget - (have0 + produced));
            const desiredUnits = Math.ceil(remaining / perUnit);
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
              logger.debug(`Smelt: put fuel x${topUp} ${fuelItem}`);
              acted = true;
            }
          }
        } catch (err) {
          logger.warn(`Smelt: Failed to put fuel: ${err}`);
        }

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
            logger.debug(`Smelt: took output (have ~${have0 + Math.max(localOutputTaken, getItemCount(wantItem) - have0)}/${outTarget})`);
            acted = true;
          }
        } catch (err) {
          logger.warn(`Smelt: Failed to take output: ${err}`);
        }

        const hasInput = !!furnace.inputItem();
        const hasOutput = !!furnace.outputItem();
        const prog = Number.isFinite(furnace.progress) ? furnace.progress : 0;
        const curOut = getItemCountInInventory(bot, wantItem);

        if (curOut > prevOut) {
          lastActivity = Date.now();
          prevOut = curOut;
        }
        if (acted || prog > lastProgress || hasInput || hasOutput) {
          lastActivity = Date.now();
        }
        lastProgress = prog;
        await sleep(400);
      }

      try { furnace.close(); } catch (_) {}

      const finalHave = getItemCountInInventory(bot, wantItem);
      logger.info(`Smelt: Complete (have ${finalHave}/${outTarget} ${wantItem})`);
    } catch (err) {
      logger.error('Smelt: Error during smelt run', err);
    } finally {
      smeltDone = true;
    }
  };

  // smelt -> break
  const smeltToBreak = new StateTransition({
    parent: smeltRun,
    child: breakFurnace,
    name: 'Smelt: smelt -> break',
    shouldTransition: () => smeltDone,
    onTransition: () => {
      furnaceCountBeforeBreak = getItemCountInInventory(bot, 'furnace');
      const have = getItemCountInInventory(bot, wantItem);
      logger.info(`Smelt: Smelting done (${have} ${wantItem}), breaking furnace (had ${furnaceCountBeforeBreak})`);
    }
  });

  // break -> wait for auto-pickup
  const breakToWait = new StateTransition({
    parent: breakFurnace,
    child: waitForPickup,
    name: 'Smelt: break -> wait',
    shouldTransition: () => breakFurnace.isFinished(),
    onTransition: () => {
      waitStartTime = Date.now();
      logger.info('Smelt: Furnace broken, waiting for auto-pickup');
    }
  });

  // wait -> exit (already picked up, after giving drop time to spawn)
  const waitToExitPickedUp = new StateTransition({
    parent: waitForPickup,
    child: exit,
    name: 'Smelt: wait -> exit (picked up)',
    shouldTransition: () => hasPickedUpFurnace() && Date.now() - waitStartTime > 1000,
    onTransition: () => {
      const have = getItemCountInInventory(bot, wantItem);
      logger.info(`Smelt: Auto-picked up furnace, complete (${have} ${wantItem})`);
    }
  });

  // wait -> findDrop (not picked up after delay for drop to spawn)
  const waitToFindDrop = new StateTransition({
    parent: waitForPickup,
    child: findDrop,
    name: 'Smelt: wait -> find drop',
    shouldTransition: () => !hasPickedUpFurnace() && Date.now() - waitStartTime > 1000,
    onTransition: () => {
      dropTargets.entity = null;
      logger.info('Smelt: Not auto-picked up, looking for drop');
    }
  });

  // findDrop -> exit (picked up)
  const findDropToExitPickedUp = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'Smelt: find drop -> exit (picked up)',
    shouldTransition: () => hasPickedUpFurnace(),
    onTransition: () => {
      const have = getItemCountInInventory(bot, wantItem);
      logger.info(`Smelt: Picked up furnace, complete (${have} ${wantItem})`);
    }
  });

  // findDrop -> followDrop
  const findDropToFollow = new StateTransition({
    parent: findDrop,
    child: followDrop,
    name: 'Smelt: find drop -> follow',
    shouldTransition: () => !!dropTargets.entity,
    onTransition: () => {
      const pos = dropTargets.entity?.position;
      logger.info(`Smelt: Found drop at (${pos?.x?.toFixed(1)}, ${pos?.y?.toFixed(1)}, ${pos?.z?.toFixed(1)})`);
    }
  });

  // findDrop -> exit (timeout)
  let findDropStartTime = 0;
  const findDropOnEnter = findDrop.onStateEntered?.bind(findDrop);
  findDrop.onStateEntered = () => {
    findDropStartTime = Date.now();
    if (findDropOnEnter) findDropOnEnter();
  };
  const findDropToExitTimeout = new StateTransition({
    parent: findDrop,
    child: exit,
    name: 'Smelt: find drop -> exit (timeout)',
    shouldTransition: () => !dropTargets.entity && Date.now() - findDropStartTime > 3000,
    onTransition: () => {
      const have = getItemCountInInventory(bot, wantItem);
      logger.warn(`Smelt: Could not find dropped furnace, exiting (${have} ${wantItem})`);
    }
  });

  // followDrop -> exit (picked up)
  const followDropToExitPickedUp = new StateTransition({
    parent: followDrop,
    child: exit,
    name: 'Smelt: follow drop -> exit (picked up)',
    shouldTransition: () => hasPickedUpFurnace(),
    onTransition: () => {
      const have = getItemCountInInventory(bot, wantItem);
      logger.info(`Smelt: Collected furnace, complete (${have} ${wantItem})`);
    }
  });

  // followDrop -> exit (timeout)
  let followStartTime = 0;
  const followOnEnter = followDrop.onStateEntered?.bind(followDrop);
  followDrop.onStateEntered = () => {
    followStartTime = Date.now();
    if (followOnEnter) followOnEnter();
  };
  const followDropToExitTimeout = new StateTransition({
    parent: followDrop,
    child: exit,
    name: 'Smelt: follow drop -> exit (timeout)',
    shouldTransition: () => Date.now() - followStartTime > 5000,
    onTransition: () => {
      const have = getItemCountInInventory(bot, wantItem);
      logger.warn(`Smelt: Follow timeout, exiting (${have} ${wantItem})`);
    }
  });

  const transitions = [
    enterToExit,
    enterToPlace,
    placeToExitFailed,
    placeToSmelt,
    smeltToBreak,
    breakToWait,
    waitToExitPickedUp,
    waitToFindDrop,
    findDropToExitPickedUp,
    findDropToFollow,
    findDropToExitTimeout,
    followDropToExitPickedUp,
    followDropToExitTimeout
  ];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);

  stateMachine.onStateExited = function () {
    for (const sub of [placeFurnace, breakFurnace, followDrop]) {
      if (sub && typeof sub.onStateExited === 'function') {
        try { sub.onStateExited(); } catch (_) {}
      }
    }
    try { bot.clearControlStates(); } catch (_) {}
  };

  return stateMachine;
}

export default createSmeltState;
