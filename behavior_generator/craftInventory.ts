import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, CraftTargets } from './types';

import createCraftNoTableState from '../behaviors/behaviorCraftNoTable';

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is an inventory crafting action
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  return !!step && step.action === 'craft' && step.what === 'inventory';
}

/**
 * Computes crafting targets from an action step
 * @param step - Craft action step
 * @returns Crafting targets or null if invalid
 */
export function computeTargetsForCraftInInventory(step: ActionStep): CraftTargets | null {
  if (!canHandle(step)) return null;

  const result = 'result' in step ? (step as any).result : null;
  const itemName = result && result.item ? result.item : null;
  const perCraftCount = result && result.perCraftCount ? result.perCraftCount : 1;
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

