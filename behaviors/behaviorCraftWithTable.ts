const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

const minecraftData = require('minecraft-data');

import { getItemCountInInventory } from '../utils/inventory';
import createPlaceNearState from './behaviorPlaceNear';
import logger from '../utils/logger';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  [key: string]: any;
}

interface Block {
  name?: string;
  [key: string]: any;
}

interface Bot {
  version?: string;
  findBlocks?: (options: { matching: (b: Block) => boolean; maxDistance: number; count: number }) => Vec3Like[];
  findBlock?: (options: { matching: (block: Block) => boolean; maxDistance: number }) => Block | null;
  blockAt?: (pos: Vec3Like, extraInfos: boolean) => Block | null;
  recipesFor: (itemId: number, metadata: any, minResultCount: number, craftingTable: Block | null) => any[];
  recipesAll: (itemId: number, metadata: any, craftingTable: Block | null) => any[];
  craft: (recipe: any, count: number, craftingTable: Block) => Promise<void>;
  [key: string]: any;
}

interface Targets {
  itemName: string;
  amount: number;
  placedPosition?: Vec3Like;
  [key: string]: any;
}

interface MinecraftData {
  itemsByName: Record<string, { id: number }>;
  items: Record<number, { name: string }>;
}

const createCraftWithTableState = (bot: Bot, targets: Targets): any => {
  function findCraftingTableNearby(): Block | null {
    let craftingTable: Block | null = null;
    try {
      // Prefer placed position if provided (from place behavior)
      if (targets && targets.placedPosition && bot.blockAt) {
        const maybe = bot.blockAt(targets.placedPosition, false);
        if (maybe && maybe.name === 'crafting_table') craftingTable = maybe;
      }
    } catch (_) {}
    if (!craftingTable) {
      try {
        const list =
          (bot.findBlocks &&
            bot.findBlocks({ matching: (b) => b.name === 'crafting_table', maxDistance: 4, count: 4 })) ||
          [];
        for (const p of list) {
          const b = bot.blockAt && bot.blockAt(p, false);
          if (b && b.name === 'crafting_table') {
            craftingTable = b;
            break;
          }
        }
      } catch (_) {}
      if (!craftingTable && bot.findBlock)
        craftingTable = bot.findBlock({ matching: (block) => block.name === 'crafting_table', maxDistance: 4 });
    }
    return craftingTable;
  }

  const craftItemWithTable = async (itemName: string, additionalNeeded: number): Promise<boolean> => {
    const mcData: MinecraftData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
      logger.error(`BehaviorCraftWithTable: Item ${itemName} not found`);
      return false;
    }

    const craftingTable = findCraftingTableNearby();

    if (!craftingTable) {
      logger.error(`BehaviorCraftWithTable: No crafting table within range`);
      return false;
    }

    logger.info(`BehaviorCraftWithTable: Searching for recipes for ${itemName} (id: ${item.id})`);
    // Use recipesFor with minResultCount=1 to find recipes where bot has ingredients for at least 1 craft
    const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
    logger.info(`BehaviorCraftWithTable: Found ${recipes.length} craftable recipes`);

    const recipe = recipes[0];

    if (!recipe) {
      logger.error(`BehaviorCraftWithTable: No recipe found for ${itemName}. Available recipes: ${recipes.length}`);
      return false;
    }

    const startingCount = getItemCountInInventory(bot, itemName);
    const targetCount = startingCount + additionalNeeded;
    let currentCount = startingCount;

    logger.info(
      `BehaviorCraftWithTable: Starting with ${startingCount} ${itemName}, need ${additionalNeeded} more (target: ${targetCount})`
    );

    const hasIngredients = recipe.delta
      .filter((item: any) => item.count < 0)
      .every((item: any) => {
        const requiredCount = Math.abs(item.count);
        const availableCount = getItemCountInInventory(bot, mcData.items[item.id].name);
        const hasEnough = availableCount >= requiredCount;

        if (!hasEnough) {
          logger.warn(
            `BehaviorCraftWithTable: Missing ingredients. Need ${requiredCount} ${mcData.items[item.id].name} but only have ${availableCount}`
          );
        }

        return hasEnough;
      });

    if (!hasIngredients) {
      logger.error(`BehaviorCraftWithTable: Cannot craft ${itemName} - missing ingredients`);
      return false;
    }

    try {
      const remainingNeeded = targetCount - currentCount;
      const timesToCraft = Math.min(
        Math.ceil(remainingNeeded / recipe.result.count),
        Math.floor(64 / recipe.result.count)
      );

      logger.info(`BehaviorCraftWithTable: Attempting to craft ${timesToCraft} times`);

      await bot.craft(recipe, timesToCraft, craftingTable);

      const newCount = getItemCountInInventory(bot, itemName);
      logger.info(
        `BehaviorCraftWithTable: Successfully crafted. Inventory now has ${newCount}/${targetCount} ${itemName} (started with ${startingCount})`
      );

      if (newCount === currentCount) {
        logger.error('BehaviorCraftWithTable: Crafting did not increase item count');
        return false;
      }

      return newCount >= targetCount;
    } catch (err) {
      logger.error(`BehaviorCraftWithTable: Error crafting ${itemName}:`, err);
      return false;
    }
  };

  const enter = new BehaviorIdle();
  const checkForTable = new BehaviorIdle();
  
  const mcData: MinecraftData = minecraftData(bot.version);
  const craftingTableItem = mcData.itemsByName['crafting_table'];
  const placeTableTargets = { 
    item: craftingTableItem ? bot.inventory.items().find((i: any) => i && i.name === 'crafting_table') : null,
    placedPosition: undefined,
    placedConfirmed: false
  };
  const placeTable = createPlaceNearState(bot, placeTableTargets);
  
  const waitForCraft = new BehaviorIdle();
  const exit = new BehaviorIdle();

  const enterToExit = new StateTransition({
    parent: enter,
    child: exit,
    name: 'BehaviorCraftWithTable: enter -> exit',
    shouldTransition: () => targets.itemName == null || targets.amount == null,
    onTransition: () => {
      if (targets.itemName == null) {
        logger.error('BehaviorCraftWithTable: Error: No item name');
      }
      if (targets.amount == null) {
        logger.error('BehaviorCraftWithTable: Error: No amount');
      }
      logger.info('BehaviorCraftWithTable: enter -> exit');
    }
  });

  const enterToCheckForTable = new StateTransition({
    parent: enter,
    child: checkForTable,
    name: 'BehaviorCraftWithTable: enter -> check for table',
    shouldTransition: () => targets.itemName != null && targets.amount != null,
    onTransition: () => {
      logger.info('BehaviorCraftWithTable: enter -> check for table');
    }
  });

  const checkForTableToPlaceTable = new StateTransition({
    parent: checkForTable,
    child: placeTable,
    name: 'BehaviorCraftWithTable: check for table -> place table',
    shouldTransition: () => {
      const tableNearby = findCraftingTableNearby();
      if (tableNearby) return false;
      
      const hasTableInInventory = getItemCountInInventory(bot, 'crafting_table') > 0;
      if (!hasTableInInventory) {
        logger.error('BehaviorCraftWithTable: No crafting table nearby and none in inventory');
        return false;
      }
      
      return true;
    },
    onTransition: () => {
      logger.info('BehaviorCraftWithTable: No crafting table nearby, placing one');
      placeTableTargets.item = bot.inventory.items().find((i: any) => i && i.name === 'crafting_table') || null;
      placeTableTargets.placedPosition = undefined;
      placeTableTargets.placedConfirmed = false;
    }
  });

  const placeTableToWaitForCraft = new StateTransition({
    parent: placeTable,
    child: waitForCraft,
    name: 'BehaviorCraftWithTable: place table -> wait for craft',
    shouldTransition: () => {
      if (typeof placeTable.isFinished !== 'function') return true;
      return placeTable.isFinished();
    },
    onTransition: () => {
      if (placeTableTargets.placedPosition) {
        targets.placedPosition = placeTableTargets.placedPosition;
        logger.info('BehaviorCraftWithTable: Crafting table placed, proceeding to craft');
      } else {
        logger.error('BehaviorCraftWithTable: Failed to place crafting table');
      }
    }
  });

  const checkForTableToWaitForCraft = new StateTransition({
    parent: checkForTable,
    child: waitForCraft,
    name: 'BehaviorCraftWithTable: check for table -> wait for craft',
    shouldTransition: () => {
      const tableNearby = findCraftingTableNearby();
      if (tableNearby) return true;
      
      const hasTableInInventory = getItemCountInInventory(bot, 'crafting_table') > 0;
      if (!hasTableInInventory) {
        logger.error('BehaviorCraftWithTable: No crafting table nearby and none in inventory');
        return true; // Exit to prevent infinite loop
      }
      
      return false;
    },
    onTransition: () => {
      const tableNearby = findCraftingTableNearby();
      if (tableNearby) {
        logger.info('BehaviorCraftWithTable: Found crafting table nearby');
      } else {
        logger.error('BehaviorCraftWithTable: No crafting table available, cannot craft');
      }
    }
  });

  let waitForCraftStartTime: number;
  let craftingDone = false;
  let craftingOk = false;
  const waitForCraftOnEnter = () => {
    waitForCraftStartTime = Date.now();
    logger.info('BehaviorCraftWithTable: starting craft');
    craftingDone = false;
    craftingOk = false;
    Promise.resolve()
      .then(() => craftItemWithTable(targets.itemName, targets.amount))
      .then((ok) => {
        craftingOk = !!ok;
        craftingDone = true;
      })
      .catch((err) => {
        logger.error('BehaviorCraftWithTable: craft promise error', err);
        craftingOk = false;
        craftingDone = true;
      });
  };

  // Hook into the checkForTableToWaitForCraft transition
  const originalCheckToWaitTransition = checkForTableToWaitForCraft.onTransition;
  checkForTableToWaitForCraft.onTransition = () => {
    if (originalCheckToWaitTransition) originalCheckToWaitTransition();
    waitForCraftOnEnter();
  };

  // Hook into the placeTableToWaitForCraft transition
  const originalPlaceToWaitTransition = placeTableToWaitForCraft.onTransition;
  placeTableToWaitForCraft.onTransition = () => {
    if (originalPlaceToWaitTransition) originalPlaceToWaitTransition();
    waitForCraftOnEnter();
  };

  const waitForCraftToExit = new StateTransition({
    parent: waitForCraft,
    child: exit,
    name: 'BehaviorCraftWithTable: wait for craft -> exit',
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
        logger.info(`BehaviorCraftWithTable: wait for craft -> exit (complete ${have}/${targets.amount})`);
      } else if (timedOut) {
        logger.info(`BehaviorCraftWithTable: wait for craft -> exit (timeout ${have}/${targets.amount})`);
      } else {
        logger.info(
          `BehaviorCraftWithTable: wait for craft -> exit (craftingDone=${craftingDone}, ok=${craftingOk})`
        );
      }
    }
  });

  const transitions = [
    enterToExit,
    enterToCheckForTable,
    checkForTableToPlaceTable,
    checkForTableToWaitForCraft,
    placeTableToWaitForCraft,
    waitForCraftToExit
  ];

  return new NestedStateMachine(transitions, enter, exit);
};

export default createCraftWithTableState;

