import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, CraftTargets } from './types';

import createCraftNoTableState from '../behaviors/behaviorCraftNoTable';

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is an inventory crafting action without variants
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  return !!step && 
         step.action === 'craft' && 
         step.what.variants.some(v => v.value === 'inventory') &&
         (!step.result || step.result.variants.length <= 1);
}

/**
 * Computes crafting targets from an action step
 * @param step - Craft action step
 * @returns Crafting targets or null if invalid
 */
export function computeTargetsForCraftInInventory(step: ActionStep): CraftTargets | null {
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
 * Creates a behavior state for inventory crafting
 * @param bot - Mineflayer bot instance
 * @param step - Craft action step
 * @returns Behavior state that crafts in inventory
 */
export function create(bot: Bot, step: ActionStep): BehaviorState | null {
  const targets = computeTargetsForCraftInInventory(step);
  if (!targets) return null;
  return createCraftNoTableState(bot as any, targets);
}

