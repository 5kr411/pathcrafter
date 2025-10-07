import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, SmeltTargets } from './types';

import createSmeltState from '../behaviors/behaviorSmelt';

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is a smelting action
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  return !!step && step.action === 'smelt';
}

/**
 * Computes smelting targets from an action step
 * @param step - Smelt action step
 * @returns Smelting targets or null if invalid
 */
export function computeTargetsForSmelt(step: ActionStep): SmeltTargets | null {
  if (!canHandle(step)) return null;

  const result = step.result;
  const input = step.input;
  const fuel = step.fuel;

  const itemName = result && result.variants.length > 0 ? result.variants[0].value.item : null;
  const amount = Number(step.count || 1);
  const inputName = input && input.variants.length > 0 ? input.variants[0].value.item : null;
  const fuelName = fuel && fuel.variants.length > 0 ? fuel.variants[0].value : 'coal';

  if (!itemName || amount <= 0) return null;

  return { itemName, amount, inputName, fuelName };
}

/**
 * Creates a behavior state for smelting
 * @param bot - Mineflayer bot instance
 * @param step - Smelt action step
 * @returns Behavior state that smelts items
 */
export function create(bot: Bot, step: ActionStep): BehaviorState | null {
  const targets = computeTargetsForSmelt(step);
  if (!targets) return null;

  try {
    return createSmeltState(bot as any, targets as any);
  } catch (_) {
    return { isFinished: () => true };
  }
}

