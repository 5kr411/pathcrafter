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
         (step.what === 'inventory' || step.what === 'table') &&
         !!(step.resultVariants && step.resultVariants.length > 1);
}

/**
 * Computes crafting targets from an action step with variants
 * @param step - Craft action step with variants
 * @returns Crafting targets or null if invalid
 */
export function computeTargetsForCraftVariant(step: ActionStep): CraftTargets | null {
  if (!canHandle(step)) return null;

  const result = 'result' in step ? (step as any).result : null;
  const perCraftCount = result && result.perCraftCount ? result.perCraftCount : 1;
  const total = Number(step.count || 1) * perCraftCount;

  if (total <= 0) return null;

  // Determine which variant to craft based on species context
  const speciesContext = getCurrentSpeciesContext();
  let itemName: string | null = null;

  if (speciesContext && step.resultVariants) {
    // Try to find a variant that matches the species context
    const matchingVariant = step.resultVariants.find(variant => 
      variant.startsWith(speciesContext)
    );
    if (matchingVariant) {
      itemName = matchingVariant;
    }
  }

  // Fallback to first variant if no species match or no context
  if (!itemName && step.resultVariants && step.resultVariants.length > 0) {
    itemName = step.resultVariants[0];
  }

  // Final fallback to primary result
  if (!itemName && result && result.item) {
    itemName = result.item;
  }

  if (!itemName) return null;

  logger.info(`BehaviorGenerator(craft-variant): selected ${itemName} from variants [${step.resultVariants?.join(', ')}] based on species context: ${speciesContext || 'none'}`);

  return { itemName, amount: total };
}

/**
 * Creates a behavior state for variant crafting
 * @param bot - Mineflayer bot instance
 * @param step - Craft action step with variants
 * @returns Behavior state that crafts the appropriate variant
 */
export function create(bot: Bot, step: ActionStep): BehaviorState | null {
  const targets = computeTargetsForCraftVariant(step);
  if (!targets) return null;

  if (step.what === 'inventory') {
    return createCraftNoTableState(bot as any, targets);
  } else if (step.what === 'table') {
    return createCraftWithTableIfNeeded(bot as any, targets);
  }

  return null;
}
