const { StateTransition, BehaviorIdle, NestedStateMachine, BehaviorGetClosestEntity, BehaviorFollowEntity } = require('mineflayer-statemachine');

const minecraftData = require('minecraft-data');

import { getItemCountInInventory } from '../utils/inventory';
import createPlaceNearState from './behaviorPlaceNear';
import createBreakAtPositionState from './behaviorBreakAtPosition';
import logger from '../utils/logger';
import { addStateLogging } from '../utils/stateLogging';

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
  itemName?: string;
  amount: number;
  placedPosition?: Vec3Like;
  variantStep?: any;
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
  
  // Track whether we placed the table (need to clean up)
  let wePlacedTable = false;
  
  // Track crafting table count before breaking
  let craftingTableCountBeforeBreak = 0;
  
  // Break table after crafting (if we placed it)
  const breakTargets: { position: any } = { position: null };
  const breakTable = createBreakAtPositionState(bot as any, breakTargets);
  
  // Collect dropped table
  const COLLECT_TIMEOUT_MS = 7000;
  const MAX_COLLECT_RETRIES = 2;
  const FOLLOW_TIMEOUT_MS = 7000;
  const MAX_FOLLOW_RETRIES = 2;
  
  const dropTargets: { entity: any } = { entity: null };
  const getDrop = new BehaviorGetClosestEntity(bot, dropTargets, (e: any) => 
    e.name === 'item' && e.getDroppedItem && e.getDroppedItem()?.name === 'crafting_table'
  );
  addStateLogging(getDrop, 'GetClosestEntity', { logEnter: true, getExtraInfo: () => 'looking for dropped crafting_table' });
  
  const followDrop = new BehaviorFollowEntity(bot, dropTargets);
  addStateLogging(followDrop, 'FollowEntity', {
    logEnter: true,
    getExtraInfo: () => {
      if (dropTargets.entity) {
        const pos = dropTargets.entity.position;
        return `following dropped table at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), distance: ${bot.entity?.position?.distanceTo?.(pos)?.toFixed(2) || 'n/a'}m`;
      }
      return 'no entity';
    }
  });
  
  let collectStartTime: number = 0;
  let followStartTime: number = 0;
  let collectRetryCount = 0;
  let followRetryCount = 0;
  
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
        wePlacedTable = true; // We placed it, so we need to break it later
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
    
    if (!targets.itemName) {
      logger.error('BehaviorCraftWithTable: no itemName set');
      craftingOk = false;
      craftingDone = true;
      return;
    }
    
    Promise.resolve()
      .then(() => craftItemWithTable(targets.itemName!, targets.amount))
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

  const craftDone = () => {
    if (!targets.itemName) return craftingDone;
    const have = getItemCountInInventory(bot, targets.itemName);
    if (have >= targets.amount) return true;
    const timedOut = Date.now() - waitForCraftStartTime > 20000;
    if (timedOut) return true;
    return craftingDone;
  };
  
  // If we placed the table, break it after crafting
  const waitForCraftToBreakTable = new StateTransition({
    parent: waitForCraft,
    child: breakTable,
    name: 'BehaviorCraftWithTable: wait for craft -> break table',
    shouldTransition: () => wePlacedTable && craftDone(),
    onTransition: () => {
      craftingTableCountBeforeBreak = getItemCountInInventory(bot, 'crafting_table');
      
      if (!targets.itemName) {
        logger.info(`BehaviorCraftWithTable: wait for craft -> break table (no itemName), have ${craftingTableCountBeforeBreak} tables`);
      } else {
        const have = getItemCountInInventory(bot, targets.itemName);
        logger.info(`BehaviorCraftWithTable: wait for craft -> break table (${have}/${targets.amount}), have ${craftingTableCountBeforeBreak} tables`);
      }
      
      // Set break position to the placed table position
      if (placeTableTargets.placedPosition) {
        breakTargets.position = placeTableTargets.placedPosition;
      }
    }
  });
  
  // If we found an existing table, just exit
  const waitForCraftToExit = new StateTransition({
    parent: waitForCraft,
    child: exit,
    name: 'BehaviorCraftWithTable: wait for craft -> exit',
    shouldTransition: () => !wePlacedTable && craftDone(),
    onTransition: () => {
      if (!targets.itemName) {
        logger.info('BehaviorCraftWithTable: wait for craft -> exit (no itemName)');
        return;
      }
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
  
  // Exit immediately if table was already picked up after breaking
  const breakTableToExitIfPickedUp = new StateTransition({
    parent: breakTable,
    child: exit,
    name: 'BehaviorCraftWithTable: break table -> exit (already picked up)',
    shouldTransition: () => {
      if (!breakTable.isFinished()) return false;
      const currentCount = getItemCountInInventory(bot, 'crafting_table');
      return currentCount > craftingTableCountBeforeBreak;
    },
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'crafting_table');
      logger.info(`BehaviorCraftWithTable: break table -> exit (already picked up: ${craftingTableCountBeforeBreak} -> ${currentCount})`);
    }
  });
  
  // After breaking, collect the drop
  const breakTableToGetDrop = new StateTransition({
    parent: breakTable,
    child: getDrop,
    name: 'BehaviorCraftWithTable: break table -> get drop',
    shouldTransition: () => breakTable.isFinished(),
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'crafting_table');
      logger.info(`BehaviorCraftWithTable: break table -> get drop (had ${craftingTableCountBeforeBreak} tables before break, now have ${currentCount})`);
      collectStartTime = Date.now();
      collectRetryCount = 0;
    }
  });
  
  // Exit early if we picked up the table
  const getDropToExitIfPickedUp = new StateTransition({
    parent: getDrop,
    child: exit,
    name: 'BehaviorCraftWithTable: get drop -> exit (picked up)',
    shouldTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'crafting_table');
      return currentCount > craftingTableCountBeforeBreak;
    },
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'crafting_table');
      logger.info(`BehaviorCraftWithTable: get drop -> exit (picked up: ${craftingTableCountBeforeBreak} -> ${currentCount})`);
    }
  });
  
  // Follow the drop entity
  const getDropToFollowDrop = new StateTransition({
    parent: getDrop,
    child: followDrop,
    name: 'BehaviorCraftWithTable: get drop -> follow drop',
    shouldTransition: () => {
      const elapsed = Date.now() - collectStartTime;
      if (elapsed > COLLECT_TIMEOUT_MS) return false;
      return !!dropTargets.entity;
    },
    onTransition: () => {
      const entity = dropTargets.entity;
      if (entity && entity.position) {
        logger.info(
          `BehaviorCraftWithTable: get drop -> follow drop (x=${entity.position.x}, y=${entity.position.y}, z=${entity.position.z})`
        );
        followStartTime = Date.now();
        followRetryCount = 0;
      }
    }
  });
  
  // Retry getDrop if timed out
  const getDropRetry = new StateTransition({
    parent: getDrop,
    child: getDrop,
    name: 'BehaviorCraftWithTable: get drop -> get drop (retry)',
    shouldTransition: () => {
      const elapsed = Date.now() - collectStartTime;
      const timedOut = elapsed > COLLECT_TIMEOUT_MS;
      return timedOut && !dropTargets.entity && collectRetryCount < MAX_COLLECT_RETRIES;
    },
    onTransition: () => {
      collectRetryCount++;
      logger.info(`BehaviorCraftWithTable: get drop -> get drop (retry ${collectRetryCount}/${MAX_COLLECT_RETRIES})`);
      collectStartTime = Date.now();
    }
  });
  
  // Exit if getDrop timed out after retries
  const getDropToExit = new StateTransition({
    parent: getDrop,
    child: exit,
    name: 'BehaviorCraftWithTable: get drop -> exit',
    shouldTransition: () => {
      const elapsed = Date.now() - collectStartTime;
      const timedOut = elapsed > COLLECT_TIMEOUT_MS;
      return timedOut && collectRetryCount >= MAX_COLLECT_RETRIES;
    },
    onTransition: () => {
      logger.info(`BehaviorCraftWithTable: get drop -> exit (timeout after ${MAX_COLLECT_RETRIES} retries)`);
    }
  });
  
  // Exit early if we picked up the table while following
  const followDropToExitIfPickedUp = new StateTransition({
    parent: followDrop,
    child: exit,
    name: 'BehaviorCraftWithTable: follow drop -> exit (picked up)',
    shouldTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'crafting_table');
      return currentCount > craftingTableCountBeforeBreak;
    },
    onTransition: () => {
      const currentCount = getItemCountInInventory(bot, 'crafting_table');
      logger.info(`BehaviorCraftWithTable: follow drop -> exit (picked up: ${craftingTableCountBeforeBreak} -> ${currentCount})`);
    }
  });
  
  // Retry followDrop if timed out
  const followDropRetry = new StateTransition({
    parent: followDrop,
    child: getDrop,
    name: 'BehaviorCraftWithTable: follow drop -> get drop (retry)',
    shouldTransition: () => {
      const elapsed = Date.now() - followStartTime;
      const timedOut = elapsed > FOLLOW_TIMEOUT_MS;
      return timedOut && followRetryCount < MAX_FOLLOW_RETRIES;
    },
    onTransition: () => {
      followRetryCount++;
      logger.info(`BehaviorCraftWithTable: follow drop -> get drop (retry ${followRetryCount}/${MAX_FOLLOW_RETRIES})`);
      collectStartTime = Date.now();
    }
  });
  
  // Exit if followDrop timed out after retries
  const followDropToExit = new StateTransition({
    parent: followDrop,
    child: exit,
    name: 'BehaviorCraftWithTable: follow drop -> exit',
    shouldTransition: () => {
      const elapsed = Date.now() - followStartTime;
      const timedOut = elapsed > FOLLOW_TIMEOUT_MS;
      return timedOut && followRetryCount >= MAX_FOLLOW_RETRIES;
    },
    onTransition: () => {
      logger.info(`BehaviorCraftWithTable: follow drop -> exit (timeout after ${MAX_FOLLOW_RETRIES} retries)`);
    }
  });
  
  // Success: collected the drop
  const followDropToExit2 = new StateTransition({
    parent: followDrop,
    child: exit,
    name: 'BehaviorCraftWithTable: follow drop -> exit',
    shouldTransition: () => {
      if (!dropTargets.entity) return true;
      const elapsed = Date.now() - followStartTime;
      if (elapsed > FOLLOW_TIMEOUT_MS) return false;
      const entity = dropTargets.entity;
      if (!entity || !entity.position) return true;
      const dist = bot.entity?.position?.distanceTo?.(entity.position);
      if (dist == null) return false;
      return dist < 2;
    },
    onTransition: () => {
      logger.info('BehaviorCraftWithTable: follow drop -> exit (collected)');
    }
  });

  const transitions = [
    enterToExit,
    enterToCheckForTable,
    checkForTableToPlaceTable,
    checkForTableToWaitForCraft,
    placeTableToWaitForCraft,
    waitForCraftToBreakTable,
    waitForCraftToExit,
    breakTableToExitIfPickedUp,
    breakTableToGetDrop,
    getDropToExitIfPickedUp,
    getDropToFollowDrop,
    getDropRetry,
    getDropToExit,
    followDropToExitIfPickedUp,
    followDropRetry,
    followDropToExit,
    followDropToExit2
  ];

  return new NestedStateMachine(transitions, enter, exit);
};

export default createCraftWithTableState;

