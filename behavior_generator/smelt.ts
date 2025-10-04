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

  const result = 'result' in step ? (step as any).result : null;
  const input = 'input' in step ? (step as any).input : null;
  const fuel = 'fuel' in step ? (step as any).fuel : null;

  const itemName = result && result.item ? result.item : null;
  const amount = Number(step.count || 1);
  const inputName = input && input.item ? input.item : null;
  const fuelName = fuel || 'coal';

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

