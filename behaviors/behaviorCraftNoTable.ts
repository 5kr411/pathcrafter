const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import { getItemCountInInventory } from '../utils/inventory';
const minecraftData = require('minecraft-data');
import logger from '../utils/logger';

interface Bot {
  version?: string;
  inventory: {
    slots: any[];
    firstEmptyInventorySlot: () => number;
    items?: () => any[];
  };
  recipesFor: (itemId: number, metadata: any, minResultCount: number, craftingTable: any) => any[];
  recipesAll: (itemId: number, metadata: any, craftingTable: any) => any[];
  craft: (recipe: any, count: number, craftingTable: any) => Promise<void>;
  moveSlotItem: (sourceSlot: number, destSlot: number) => Promise<void>;
  [key: string]: any;
}

interface Targets {
  itemName?: string;
  amount: number;
  variantStep?: any;
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

  const selectVariantFromInventory = (step: any): string | undefined => {
    if (!step || !step.result || !step.ingredients) return undefined;
    
    const invItems = bot.inventory?.items?.() || [];
    const inventory: Record<string, number> = {};
    invItems.forEach((item: any) => {
      inventory[item.name] = (inventory[item.name] || 0) + item.count;
    });

    const resultVariants = step.result.variants || [];
    const ingredientVariants = step.ingredients.variants || [];

    for (let i = 0; i < resultVariants.length; i++) {
      const resultVariant = resultVariants[i];
      const ingredientVariant = ingredientVariants[i];
      if (!resultVariant || !ingredientVariant) continue;

      const ingredients = Array.isArray(ingredientVariant.value) ? ingredientVariant.value : [];
      const hasAllIngredients = ingredients.every((ing: any) => {
        return ing && ing.item && (inventory[ing.item] || 0) >= (ing.perCraftCount || 1);
      });

      if (hasAllIngredients) {
        const itemName = resultVariant.value?.item || resultVariant.value;
        logger.info(`BehaviorCraftNoTable: Selected variant ${itemName} based on inventory`);
        return itemName;
      }
    }

    return undefined;
  };

  const craftItemNoTable = async (itemName: string, additionalNeeded: number): Promise<boolean> => {
    const mcData: MinecraftData = minecraftData(bot.version);
    const item = mcData.itemsByName[itemName];

    if (!item) {
      logger.error(`BehaviorCraftNoTable: Item ${itemName} not found`);
      return false;
    }

    // Log current inventory
    const invItems = bot.inventory?.items?.() || [];
    const invSummary = invItems
      .map((it: any) => `${it.name}:${it.count}`)
      .join(', ');
    logger.info(`BehaviorCraftNoTable: Current inventory: ${invSummary || 'empty'}`);
    
    logger.info(`BehaviorCraftNoTable: Looking for recipes for ${itemName} (id: ${item.id})`);
    
    // Use recipesFor with minResultCount=1 to find recipes where bot has ingredients for at least 1 craft
    const allRecipes = bot.recipesFor(item.id, null, 1, null);
    logger.info(`BehaviorCraftNoTable: Found ${allRecipes.length} craftable recipes for ${itemName}`);
    
    const recipe = allRecipes.find((r: any) => !r.requiresTable);
    if (!recipe) {
      logger.error(`BehaviorCraftNoTable: No craftable recipe found for ${itemName} that doesn't require a crafting table (had ${allRecipes.length} craftable recipes total)`);
      return false;
    }
    
    logger.info(`BehaviorCraftNoTable: Selected recipe with ${recipe.delta?.length || 0} delta items`);

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
    shouldTransition: () => {
      // Allow crafting if variantStep is set, even if itemName is null
      if (targets.variantStep && targets.amount != null) {
        return false;
      }
      return targets.itemName == null || targets.amount == null;
    },
    onTransition: () => {
      if (targets.itemName == null && !targets.variantStep) {
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
    shouldTransition: () => (targets.itemName != null || targets.variantStep != null) && targets.amount != null,
    onTransition: () => {
      waitForCraftStartTime = Date.now();
      logger.info('BehaviorCraftNoTable: enter -> wait for craft');
      craftingDone = false;
      craftingOk = false;
      
      let actualItemName = targets.itemName;
      
      if (!actualItemName && targets.variantStep) {
        actualItemName = selectVariantFromInventory(targets.variantStep);
        if (!actualItemName) {
          const variants = targets.variantStep?.result?.variants || [];
          const variantNames = variants.map((v: any) => v.value?.item || v.value).slice(0, 5).join(', ');
          logger.error(`BehaviorCraftNoTable: Could not select variant from inventory. Available variants: ${variantNames}`);
          craftingOk = false;
          craftingDone = true;
          return;
        }
        // Persist the selected variant back to targets
        targets.itemName = actualItemName;
      }
      
      Promise.resolve()
        .then(() => craftItemNoTable(actualItemName!, targets.amount))
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
      if (!targets.itemName) return craftingDone;
      const have = getItemCountInInventory(bot, targets.itemName);
      if (have >= targets.amount) return true;
      const timedOut = Date.now() - waitForCraftStartTime > 20000;
      if (timedOut) return true;
      return craftingDone;
    },
    onTransition: () => {
      if (!targets.itemName) {
        logger.info('BehaviorCraftNoTable: wait for craft -> exit (no itemName)');
        return;
      }
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

