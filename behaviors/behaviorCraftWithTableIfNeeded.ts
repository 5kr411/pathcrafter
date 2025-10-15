const { StateTransition, BehaviorIdle, NestedStateMachine } = require('mineflayer-statemachine');

import createCraftWithTable from './behaviorCraftWithTable';
import { getItemCountInInventory } from '../utils/inventory';

import logger from '../utils/logger';

type Bot = any;

interface Targets {
  itemName?: string;
  amount: number;
  variantStep?: any;
  [key: string]: any;
}

function createCraftWithTableIfNeeded(bot: Bot, targets: Targets): any {
  const selectVariantFromInventory = (step: any): string | null => {
    if (!step || !step.result || !step.ingredients) return null;
    
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
        logger.info(`BehaviorCraftWithTableIfNeeded: Selected variant ${itemName} based on inventory`);
        return itemName;
      }
    }

    return null;
  };

  const resolveItemName = (): string | null => {
    if (targets.itemName) return targets.itemName;
    if (targets.variantStep) {
      const selected = selectVariantFromInventory(targets.variantStep);
      if (selected) {
        targets.itemName = selected; // Persist for future checks
        return selected;
      }
    }
    return null;
  };

  const enter = new BehaviorIdle();
  const craftWithTableState = createCraftWithTable(bot, targets);
  const exit = new BehaviorIdle();

  const enterToExit = new StateTransition({
    name: 'BehaviorCraftWithTableIfNeeded: enter -> exit',
    parent: enter,
    child: exit,
    shouldTransition: () => {
      const itemName = resolveItemName();
      if (!itemName) return false;
      return getItemCountInInventory(bot, itemName) >= targets.amount;
    },
    onTransition: () => {
      const itemName = targets.itemName!;
      logger.info(
        `BehaviorCraftWithTableIfNeeded: enter -> exit: ${getItemCountInInventory(bot, itemName)}/${targets.amount} ${itemName} in inventory`
      );
    }
  });

  const enterToCraftWithTable = new StateTransition({
    parent: enter,
    child: craftWithTableState,
    name: 'BehaviorCraftWithTableIfNeeded: enter -> craft with table',
    shouldTransition: () => {
      const itemName = resolveItemName();
      if (!itemName) return false;
      return getItemCountInInventory(bot, itemName) < targets.amount;
    },
    onTransition: () => {
      const itemName = targets.itemName!;
      targets.amount = targets.amount - getItemCountInInventory(bot, itemName);
      logger.info(
        `BehaviorCraftWithTableIfNeeded: enter -> craft with table: ${getItemCountInInventory(bot, itemName)}/${targets.amount} ${itemName} in inventory`
      );
    }
  });

  const craftWithTableToExit = new StateTransition({
    parent: craftWithTableState,
    child: exit,
    name: 'BehaviorCraftWithTableIfNeeded: craft with table -> exit',
    shouldTransition: () => craftWithTableState.isFinished(),
    onTransition: () => {
      logger.info('BehaviorCraftWithTableIfNeeded: craft with table -> exit');
    }
  });

  const transitions = [enterToExit, enterToCraftWithTable, craftWithTableToExit];

  return new NestedStateMachine(transitions, enter, exit);
}

export default createCraftWithTableIfNeeded;

