const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import { getItemCountInInventory } from '../utils/inventory';
const minecraftData = require('minecraft-data');
import logger from '../utils/logger';

interface Bot {
  version?: string;
  inventory: {
    slots: any[];
    firstEmptyInventorySlot: () => number;
  };
  recipesFor: (itemId: number, metadata: any, minResultCount: number, craftingTable: any) => any[];
  craft: (recipe: any, count: number, craftingTable: any) => Promise<void>;
  moveSlotItem: (sourceSlot: number, destSlot: number) => Promise<void>;
  [key: string]: any;
}

interface Targets {
  itemName: string;
  amount: number;
  [key: string]: any;
}

interface MinecraftData {
  itemsByName: Record<string, { id: number }>;
  items: Record<number, { name: string; maxDurability?: number }>;
}

function createCraftNoTableState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const waitForCraft = new BehaviorIdle();
  const exit = new BehaviorIdle();

  function clearCraftingSlots(bot: Bot): Promise<void> {
    const craftingSlotIndices = [1, 2, 3, 4];
    return new Promise((resolve) => {
      let completedSlots = 0;

      craftingSlotIndices.forEach((index) => {
        const slot = bot.inventory.slots[index];
        if (!slot) {
          completedSlots++;
          if (completedSlots === craftingSlotIndices.length) resolve();
          return;
        }

        bot
          .moveSlotItem(index, bot.inventory.firstEmptyInventorySlot())
          .then(() => {
            logger.info(`BehaviorCraftNoTable: Moved item from crafting slot ${index} to inventory`);
            completedSlots++;
            if (completedSlots === craftingSlotIndices.length) resolve();
          })
          .catch((err: any) => {
            logger.error(`BehaviorCraftNoTable: Error moving item from crafting slot ${index}:`, err);
            completedSlots++;
            if (completedSlots === craftingSlotIndices.length) resolve();
          });
      });
    });
  }

  const craftItemNoTable = async (itemName: string, additionalNeeded: number): Promise<boolean> => {
    const mcData: MinecraftData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
      logger.error(`BehaviorCraftNoTable: Item ${itemName} not found`);
      return false;
    }

    const recipe = bot.recipesFor(item.id, null, 1, null).find((r: any) => !r.requiresTable);
    if (!recipe) {
      logger.error(`BehaviorCraftNoTable: No recipe found for ${itemName} that doesn't require a crafting table`);
      return false;
    }

    const startingCount = getItemCountInInventory(bot, itemName);
    const targetCount = startingCount + additionalNeeded;
    let currentCount = startingCount;

    logger.info(
      `BehaviorCraftNoTable: Starting with ${startingCount} ${itemName}, need ${additionalNeeded} more (target: ${targetCount})`
    );

    const hasIngredients = recipe.delta
      .filter((item: any) => item.count < 0)
      .every((item: any) => {
        const requiredCount = Math.abs(item.count);
        const availableCount = getItemCountInInventory(bot, mcData.items[item.id].name);
        const hasEnough = availableCount >= requiredCount;

        if (!hasEnough) {
          logger.warn(
            `BehaviorCraftNoTable: Missing ingredients. Need ${requiredCount} ${mcData.items[item.id].name} but only have ${availableCount}`
          );
        }

        return hasEnough;
      });

    if (!hasIngredients) {
      logger.error(`BehaviorCraftNoTable: Cannot craft ${itemName} - missing ingredients`);
      return false;
    }

    try {
      await clearCraftingSlots(bot);

      const remainingNeeded = targetCount - currentCount;
      const timesToCraft = Math.min(
        Math.ceil(remainingNeeded / recipe.result.count),
        Math.floor(64 / recipe.result.count)
      );

      logger.info(`BehaviorCraftNoTable: Attempting to craft ${timesToCraft} times`);

      await bot.craft(recipe, timesToCraft, null);

      const newCount = getItemCountInInventory(bot, itemName);
      logger.info(
        `BehaviorCraftNoTable: Successfully crafted. Inventory now has ${newCount}/${targetCount} ${itemName} (started with ${startingCount})`
      );

      if (newCount === currentCount) {
        logger.error('BehaviorCraftNoTable: Crafting did not increase item count');
        return false;
      }

      return newCount >= targetCount;
    } catch (err) {
      logger.error(`BehaviorCraftNoTable: Error crafting ${itemName}:`, err);
      await clearCraftingSlots(bot);
      return false;
    }
  };

  const enterToExit = new StateTransition({
    parent: enter,
    child: exit,
    name: 'BehaviorCraftNoTable: enter -> exit',
    shouldTransition: () => targets.itemName == null || targets.amount == null,
    onTransition: () => {
      if (targets.itemName == null) {
        logger.error('BehaviorCraftNoTable: Error: No item name');
      }
      if (targets.amount == null) {
        logger.error('BehaviorCraftNoTable: Error: No amount');
      }
      logger.info('BehaviorCraftNoTable: enter -> exit');
    }
  });

  let waitForCraftStartTime: number;
  let craftingDone = false;
  let craftingOk = false;
  const enterToWaitForCraft = new StateTransition({
    parent: enter,
    child: waitForCraft,
    name: 'BehaviorCraftNoTable: enter -> wait for craft',
    shouldTransition: () => targets.itemName != null && targets.amount != null,
    onTransition: () => {
      waitForCraftStartTime = Date.now();
      logger.info('BehaviorCraftNoTable: enter -> wait for craft');
      craftingDone = false;
      craftingOk = false;
      Promise.resolve()
        .then(() => craftItemNoTable(targets.itemName, targets.amount))
        .then((ok) => {
          craftingOk = !!ok;
          craftingDone = true;
        })
        .catch((err) => {
          logger.error('BehaviorCraftNoTable: craft promise error', err);
          craftingOk = false;
          craftingDone = true;
        });
    }
  });

  const waitForCraftToExit = new StateTransition({
    parent: waitForCraft,
    child: exit,
    name: 'BehaviorCraftNoTable: wait for craft -> exit',
    shouldTransition: () => {
      const have = getItemCountInInventory(bot, targets.itemName);
      if (have >= targets.amount) return true;
      const timedOut = Date.now() - waitForCraftStartTime > 20000;
      if (timedOut) return true;
      return craftingDone;
    },
    onTransition: () => {
      const have = getItemCountInInventory(bot, targets.itemName);
      const timedOut = Date.now() - waitForCraftStartTime > 20000;
      if (have >= targets.amount) {
        logger.info(`BehaviorCraftNoTable: wait for craft -> exit (complete ${have}/${targets.amount})`);
      } else if (timedOut) {
        logger.info(`BehaviorCraftNoTable: wait for craft -> exit (timeout ${have}/${targets.amount})`);
      } else {
        logger.info(`BehaviorCraftNoTable: wait for craft -> exit (craftingDone=${craftingDone}, ok=${craftingOk})`);
      }
    }
  });

  const transitions = [enterToExit, enterToWaitForCraft, waitForCraftToExit];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createCraftNoTableState;

