import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, CraftTargets } from './types';
import { getCurrentSpeciesContext } from '../utils/context';
import createCraftNoTableState from '../behaviors/behaviorCraftNoTable';
import createCraftWithTableIfNeeded from '../behaviors/behaviorCraftWithTableIfNeeded';
import logger from '../utils/logger';

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is a crafting action with result variants
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  return !!step && 
         step.action === 'craft' && 
         (step.what.variants.some(v => v.value === 'inventory') || step.what.variants.some(v => v.value === 'table')) &&
         !!(step.result && step.result.variants.length > 1);
}

/**
 * Computes crafting targets from an action step with variants
 * @param step - Craft action step with variants
 * @returns Crafting targets or null if invalid
 */
export function computeTargetsForCraftVariant(step: ActionStep, bot?: Bot): CraftTargets | null {
  if (!canHandle(step)) return null;

  const result = step.result;
  if (!result || result.variants.length === 0) return null;
  
  const firstResult = result.variants[0].value;
  const perCraftCount = firstResult.perCraftCount || 1;
  const total = Number(step.count || 1) * perCraftCount;

  if (total <= 0) return null;

  let itemName: string | null = null;
  let selectionMethod = 'default';

  // Strategy 1: Check inventory for ingredients (most reliable)
  if (bot && step.ingredients && step.ingredients.variants.length > 0) {
    try {
      const inventory: Record<string, number> = {};
      (bot.inventory?.items() || []).forEach((item: any) => {
        inventory[item.name] = (inventory[item.name] || 0) + item.count;
      });

      // Find a result variant whose ingredients are all in inventory
      for (let i = 0; i < result.variants.length; i++) {
        const resultVariant = result.variants[i];
        const ingredientVariant = step.ingredients.variants[i];
        if (!ingredientVariant) continue;

        const ingredients = Array.isArray(ingredientVariant.value) ? ingredientVariant.value : [];
        const hasAllIngredients = ingredients.every((ing: any) => {
          return ing && ing.item && (inventory[ing.item] || 0) >= (ing.perCraftCount || 1);
        });

        if (hasAllIngredients) {
          itemName = resultVariant.value.item;
          selectionMethod = 'inventory-match';
          break;
        }
      }
    } catch (_) {}
  }

  // Strategy 2: Use species context if set
  if (!itemName) {
    const speciesContext = getCurrentSpeciesContext();
    if (speciesContext && result.variants.length > 1) {
      const matchingVariant = result.variants.find(variant => 
        variant.value.item.startsWith(speciesContext)
      );
      if (matchingVariant) {
        itemName = matchingVariant.value.item;
        selectionMethod = 'species-context';
      }
    }
  }

  // Strategy 3: Fallback to first variant
  if (!itemName && result.variants.length > 0) {
    itemName = result.variants[0].value.item;
    selectionMethod = 'fallback-first';
  }

  if (!itemName) return null;

  const variantNames = result.variants.map(v => v.value.item).join(', ');
  logger.info(`BehaviorGenerator(craft-variant): selected ${itemName} from variants [${variantNames}] via ${selectionMethod}`);

  return { itemName, amount: total };
}

/**
 * Creates a behavior state for variant crafting
 * @param bot - Mineflayer bot instance
 * @param step - Craft action step with variants
 * @returns Behavior state that crafts the appropriate variant
 */
export function create(bot: Bot, step: ActionStep): BehaviorState | null {
  if (!canHandle(step)) return null;

  const result = step.result;
  if (!result || result.variants.length === 0) return null;
  
  const firstResult = result.variants[0].value;
  const perCraftCount = firstResult.perCraftCount || 1;
  const total = Number(step.count || 1) * perCraftCount;

  if (total <= 0) return null;

  const targets = {
    amount: total,
    variantStep: step
  };

  logger.info(`BehaviorGenerator(craft-variant): deferring variant selection to runtime (${result.variants.length} variants available)`);

  if (step.what.variants.some(v => v.value === 'inventory')) {
    return createCraftNoTableState(bot as any, targets);
  } else if (step.what.variants.some(v => v.value === 'table')) {
    return createCraftWithTableIfNeeded(bot as any, targets);
  }

  return null;
}
