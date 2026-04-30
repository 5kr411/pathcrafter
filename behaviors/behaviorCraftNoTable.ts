const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import { getItemCountInInventory } from '../utils/inventory';
import { ensureInventoryRoom } from '../utils/inventoryGate';
const minecraftData = require('minecraft-data');
import logger from '../utils/logger';

interface Bot {
  version?: string;
  inventory: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    slots: any[];
    firstEmptyInventorySlot: () => number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    items?: () => any[];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  recipesFor: (itemId: number, metadata: any, minResultCount: number, craftingTable: any) => any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  recipesAll: (itemId: number, metadata: any, craftingTable: any) => any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  craft: (recipe: any, count: number, craftingTable: any) => Promise<void>;
  moveSlotItem: (sourceSlot: number, destSlot: number) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface Targets {
  itemName?: string;
  amount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  variantStep?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  [key: string]: any;
}

interface MinecraftData {
  itemsByName: Record<string, { id: number }>;
  items: Record<number, { name: string; maxDurability?: number }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
function createCraftNoTableState(bot: Bot, targets: Targets): any {
  const enter = new BehaviorIdle();
  const waitForCraft = new BehaviorIdle();
  const exit = new BehaviorIdle();

  async function clearCraftingSlots(bot: Bot): Promise<void> {
    // Sequentially: each move must finish (and the resulting setSlot land)
    // before we sample firstEmptyInventorySlot for the next move. Running
    // them in parallel lets all four calls resolve to the same destination
    // because slot updates haven't been confirmed yet, and later moves
    // overwrite earlier ones.
    for (const index of [1, 2, 3, 4]) {
      const slot = bot.inventory.slots[index];
      if (!slot) continue;
      const dest = bot.inventory.firstEmptyInventorySlot();
      if (dest == null || dest < 0) {
        logger.warn(`BehaviorCraftNoTable: no empty inventory slot to clear crafting slot ${index}`);
        continue;
      }
      try {
        await bot.moveSlotItem(index, dest);
        logger.info(`BehaviorCraftNoTable: Moved item from crafting slot ${index} to inventory slot ${dest}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
      } catch (err: any) {
        logger.error(`BehaviorCraftNoTable: Error moving item from crafting slot ${index}:`, err);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
  const selectVariantFromInventory = (step: any): string | undefined => {
    if (!step || !step.result || !step.ingredients) return undefined;
    
    const invItems = bot.inventory?.items?.() || [];
    const inventory: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      .map((it: any) => `${it.name}:${it.count}`)
      .join(', ');
    logger.info(`BehaviorCraftNoTable: Current inventory: ${invSummary || 'empty'}`);
    
    logger.info(`BehaviorCraftNoTable: Looking for recipes for ${itemName} (id: ${item.id})`);
    
    // Use recipesFor with minResultCount=1 to find recipes where bot has ingredients for at least 1 craft
    const allRecipes = bot.recipesFor(item.id, null, 1, null);
    logger.info(`BehaviorCraftNoTable: Found ${allRecipes.length} craftable recipes for ${itemName}`);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
    const recipe = allRecipes.find((r: any) => !r.requiresTable);
    if (!recipe) {
      logger.error(`BehaviorCraftNoTable: No craftable recipe found for ${itemName} that doesn't require a crafting table (had ${allRecipes.length} craftable recipes total)`);
      return false;
    }
    
    logger.info(`BehaviorCraftNoTable: Selected recipe with ${recipe.delta?.length || 0} delta items`);

    const startingCount = getItemCountInInventory(bot, itemName);
    const targetCount = startingCount + additionalNeeded;

    logger.info(
      `BehaviorCraftNoTable: Starting with ${startingCount} ${itemName}, need ${additionalNeeded} more (target: ${targetCount})`
    );

    const hasIngredients = recipe.delta
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
      .filter((item: any) => item.count < 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
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
      await ensureInventoryRoom(bot);
      await clearCraftingSlots(bot);

      // Re-capture pre-craft count AFTER ensureInventoryRoom — the gate may
      // have dropped some of the target item to free slots. baselineCount
      // drives the state-machine polling target (`baselineCount + amount`),
      // so it must reflect what's actually in the inventory right before
      // bot.craft fires. Without this, a drop turns success into a 20s
      // timeout because the post-craft count can never reach the original
      // pre-drop baseline + amount.
      const preCraftCount = getItemCountInInventory(bot, itemName);
      baselineCount = preCraftCount;
      if (preCraftCount !== startingCount) {
        logger.info(
          `BehaviorCraftNoTable: ${itemName} count changed during inventory prep (${startingCount} -> ${preCraftCount}); rebaselined`
        );
      }

      const timesToCraft = Math.min(
        Math.ceil(additionalNeeded / recipe.result.count),
        Math.floor(64 / recipe.result.count)
      );

      logger.info(`BehaviorCraftNoTable: Attempting to craft ${timesToCraft} times`);

      try {
        await bot.craft(recipe, timesToCraft, null);
      } catch (craftErr) {
        const errMsg = craftErr instanceof Error ? craftErr.message : String(craftErr);
        logger.warn(`BehaviorCraftNoTable: craft failed (${errMsg}), retrying once`);
        await clearCraftingSlots(bot);
        await new Promise(r => setTimeout(r, 100));
        await bot.craft(recipe, timesToCraft, null);
      }
      // bot.craft resolved without throwing, but server setSlot packets that
      // update bot.inventory may still be in flight. Don't trust a synchronous
      // count check here — the state machine's polling loop verifies the final
      // count against `baselineCount + targets.amount` over a 20s window.
      await new Promise(r => setTimeout(r, 50));

      const newCount = getItemCountInInventory(bot, itemName);
      logger.info(
        `BehaviorCraftNoTable: craft attempt complete. Inventory now has ${newCount}/${targetCount} ${itemName} (started with ${startingCount})`
      );

      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`BehaviorCraftNoTable: Error crafting ${itemName}: ${errMsg}`);
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
      stateMachine.stepSucceeded = false;
      stateMachine.stepFailureReason = targets.itemName == null ? 'no_item_name' : 'no_amount';
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
  let baselineCount = 0;
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped plugin event payload
          const variantNames = variants.map((v: any) => v.value?.item || v.value).slice(0, 5).join(', ');
          logger.error(`BehaviorCraftNoTable: Could not select variant from inventory. Available variants: ${variantNames}`);
          craftingOk = false;
          craftingDone = true;
          return;
        }
        // Persist the selected variant back to targets
        targets.itemName = actualItemName;
      }

      // Record baseline BEFORE crafting so exit transition uses additive check
      baselineCount = actualItemName ? getItemCountInInventory(bot, actualItemName) : 0;

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
      const needed = baselineCount + targets.amount;
      if (have >= needed) return true;
      const timedOut = Date.now() - waitForCraftStartTime > 20000;
      if (timedOut) return true;
      // Real failures (no recipe / missing ingredients / repeated throws)
      // surface as craftingOk=false. Bail out fast rather than waiting 20s.
      if (craftingDone && !craftingOk) return true;
      // Otherwise: bot.craft resolved successfully but inventory may still
      // be syncing. Keep polling — the timeout above is the safety net.
      return false;
    },
    onTransition: () => {
      if (!targets.itemName) {
        logger.info('BehaviorCraftNoTable: wait for craft -> exit (no itemName)');
        stateMachine.stepSucceeded = false;
        return;
      }
      const have = getItemCountInInventory(bot, targets.itemName);
      const needed = baselineCount + targets.amount;
      const timedOut = Date.now() - waitForCraftStartTime > 20000;
      if (have >= needed) {
        if (!craftingOk) {
          logger.warn(`BehaviorCraftNoTable: wait for craft -> exit (complete ${have}/${needed}, craft promise failed but inventory satisfied)`);
        } else {
          logger.info(`BehaviorCraftNoTable: wait for craft -> exit (complete ${have}/${needed})`);
        }
      } else {
        stateMachine.stepSucceeded = false;
        stateMachine.stepFailureReason = timedOut
          ? `craft_timeout:${targets.itemName}:${have}/${needed}`
          : `craft_failed:${targets.itemName}:${have}/${needed}`;
        if (timedOut) {
          logger.info(`BehaviorCraftNoTable: wait for craft -> exit (timeout ${have}/${needed})`);
        } else {
          logger.info(`BehaviorCraftNoTable: wait for craft -> exit (failed ${have}/${needed}, craftingOk=${craftingOk})`);
        }
      }
    }
  });

  const transitions = [enterToExit, enterToWaitForCraft, waitForCraftToExit];

  const stateMachine = new NestedStateMachine(transitions, enter, exit);
  
  stateMachine.onStateExited = function() {
    logger.debug('CraftNoTable: cleaning up on state exit');
    
    try {
      bot.clearControlStates();
      logger.debug('CraftNoTable: cleared bot control states');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      logger.debug(`CraftNoTable: error clearing control states: ${err.message}`);
    }
  };
  
  return stateMachine;
}

export default createCraftNoTableState;

