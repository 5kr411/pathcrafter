import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, ActionHandler } from './types';

import * as craftInventory from './craftInventory';
import * as craftTable from './craftTable';
import * as craftVariant from './craftVariant';
import * as mine from './mine';
import * as mineAnyOf from './mineAnyOf';
import * as mineOneOf from './mineOneOf';
import * as smelt from './smelt';
import * as hunt from './hunt';

const ACTION_HANDLERS: ActionHandler[] = [
  smelt,
  hunt, // Hunt actions for mob drops
  craftVariant, // Check for variant crafting first
  craftInventory,
  craftTable,
  mineAnyOf, // Check for any_of mining first
  mineOneOf, // Check for one_of mining
  mine
];

/**
 * Creates a behavior state for an action step
 * 
 * Dispatches to the appropriate handler based on the step's action type.
 * 
 * @param bot - Mineflayer bot instance
 * @param step - Action step to create behavior for
 * @returns Behavior state or null if no handler can process the step
 * 
 * @example
 * const behavior = createBehaviorForStep(bot, {
 *   action: 'mine',
 *   what: 'oak_log',
 *   count: 5
 * });
 */
export function createBehaviorForStep(bot: Bot, step: ActionStep): BehaviorState | null {
  if (!step || !step.action) return null;

  for (const handler of ACTION_HANDLERS) {
    if (handler.canHandle(step)) {
      return handler.create(bot, step);
    }
  }

  return null;
}

// Re-export internal functions for testing
export const _internals = {
  computeTargetsForCraftInInventory: craftInventory.computeTargetsForCraftInInventory,
  computeTargetsForCraftInTable: craftTable.computeTargetsForCraftInTable,
  computeTargetsForCraftVariant: craftVariant.computeTargetsForCraftVariant,
  computeTargetsForMine: mine.computeTargetsForMine,
  computeTargetsForMineAnyOf: mineAnyOf.computeTargetsForMineAnyOf,
  computeTargetsForMineOneOf: mineOneOf.computeTargetsForMineOneOf,
  computeTargetsForSmelt: smelt.computeTargetsForSmelt,
  computeTargetsForHunt: hunt.computeTargetsForHunt
};

