import { ActionPath, ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, SharedState } from './types';

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import * as genMine from './mine';
import * as genMineOneOf from './mineOneOf';
import * as genCraftInventory from './craftInventory';
import * as genCraftTable from './craftTable';
import * as genCraftVariant from './craftVariant';
import * as genSmelt from './smelt';

import logger from '../utils/logger';

/**
 * Creates a behavior state for a single action step
 * 
 * @param bot - Mineflayer bot instance
 * @param step - Action step to create state for
 * @param _shared - Shared state across steps (currently unused)
 * @returns Behavior state or simple finished state if no handler found
 */
export function createStateForStep(bot: Bot, step: ActionStep, _shared: SharedState): BehaviorState {
  if (!step || !step.action) return { isFinished: () => true };

  try {
    if (genMineOneOf && typeof genMineOneOf.canHandle === 'function' && genMineOneOf.canHandle(step)) {
      const s = genMineOneOf.create(bot, step);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  try {
    if (genMine && typeof genMine.canHandle === 'function' && genMine.canHandle(step)) {
      const s = genMine.create(bot, step);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  try {
    if (genSmelt && typeof genSmelt.canHandle === 'function' && genSmelt.canHandle(step)) {
      const s = genSmelt.create(bot, step);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  try {
    if (genCraftVariant && typeof genCraftVariant.canHandle === 'function' && genCraftVariant.canHandle(step)) {
      const s = genCraftVariant.create(bot, step);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  try {
    if (genCraftInventory && typeof genCraftInventory.canHandle === 'function' && genCraftInventory.canHandle(step)) {
      const s = genCraftInventory.create(bot, step);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  try {
    if (genCraftTable && typeof genCraftTable.canHandle === 'function' && genCraftTable.canHandle(step)) {
      const s = genCraftTable.create(bot, step);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  logger.error('PathBuilder: No generator could handle step', step);
  return { isFinished: () => true };
}

/**
 * Builds a state machine for executing an entire action path
 * 
 * Creates a sequential state machine with transitions between each step.
 * Each step becomes a state, and transitions occur when the previous step finishes.
 * 
 * @param bot - Mineflayer bot instance
 * @param pathSteps - Array of action steps to execute
 * @param onFinished - Callback to invoke when path execution completes
 * @returns NestedStateMachine that executes the entire path
 * 
 * @example
 * const machine = buildStateMachineForPath(bot, path, () => {
 *   console.log('Path execution complete!');
 * });
 */
export function buildStateMachineForPath(
  bot: Bot,
  pathSteps: ActionPath,
  onFinished?: () => void
): any {
  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();
  const transitions: any[] = [];

  let prev: any = enter;
  const shared: SharedState = {};
  let isFirst = true;
  let index = 0;

  for (const step of pathSteps) {
    const st = createStateForStep(bot, step, shared);
    if (!st) continue;

    const parent = prev;
    const should = isFirst 
      ? () => true 
      : () => (parent && typeof parent.isFinished === 'function' ? parent.isFinished() : true);
    
    const stepIndex = index;
    transitions.push(new StateTransition({
      parent,
      child: st,
      name: `step:${stepIndex}:${step.action}:${step.what}`,
      shouldTransition: should,
      onTransition: () => {
        logger.info(`PathBuilder: step ${stepIndex} -> ${step.action}:${step.what}`);
      }
    }));

    prev = st;
    isFirst = false;
    index++;
  }

  transitions.push(new StateTransition({
    parent: prev,
    child: exit,
    name: 'final-exit',
    shouldTransition: () => (prev && typeof prev.isFinished === 'function' ? prev.isFinished() : true),
    onTransition: () => {
      logger.info('PathBuilder: final-exit');
      try {
        if (typeof onFinished === 'function') onFinished();
      } catch (_) {
        // Ignore callback errors
      }
    }
  }));

  return new NestedStateMachine(transitions, enter, exit);
}

// Re-export internal function for testing
export const _internals = {
  createStateForStep
};

