import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, CraftTargets } from './types';

import createCraftWithTableState from '../behaviors/behaviorCraftWithTable';

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is a table crafting action without variants
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  return !!step && 
         step.action === 'craft' && 
         step.what.variants.some(v => v.value === 'table') &&
         (!step.result || step.result.variants.length <= 1);
}

/**
 * Computes crafting targets from an action step
 * @param step - Craft action step
 * @returns Crafting targets or null if invalid
 */
export function computeTargetsForCraftInTable(step: ActionStep): CraftTargets | null {
  if (!canHandle(step)) return null;

  const result = step.result;
  if (!result || result.variants.length === 0) return null;
  
  const firstResult = result.variants[0].value;
  const itemName = firstResult.item;
  const perCraftCount = firstResult.perCraftCount || 1;
  const total = Number(step.count || 1) * perCraftCount;

  if (!itemName || total <= 0) return null;

  return { itemName, amount: total };
}

/**
 * Creates a behavior state for table crafting
 * 
 * Uses the existing behaviorCraftWithTable which handles:
 * - Finding or placing a crafting table
 * - Crafting the item
 * - Breaking and collecting the table (if placed)
 * 
 * @param bot - Mineflayer bot instance
 * @param step - Craft action step
 * @returns Behavior state that handles full table crafting workflow
 */
export function create(bot: Bot, step: ActionStep): BehaviorState | null {
  const targets = computeTargetsForCraftInTable(step);
  if (!targets) return null;
  return createCraftWithTableState(bot as any, targets);
}
