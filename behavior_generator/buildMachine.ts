import { ActionPath, ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, SharedState } from './types';
import { ExecutionContext } from '../bots/collector/execution_context';

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine
} = require('mineflayer-statemachine');

import * as genMine from './mine';
import * as genMineOneOf from './mineOneOf';
import * as genMineAnyOf from './mineAnyOf';
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
 * @param executionContext - Optional execution context for runtime interventions
 * @returns Behavior state or simple finished state if no handler found
 */
export function createStateForStep(bot: Bot, step: ActionStep, _shared: SharedState, executionContext?: ExecutionContext): BehaviorState {
  if (!step || !step.action) return { isFinished: () => true };

  try {
    if (genMineAnyOf && typeof genMineAnyOf.canHandle === 'function' && genMineAnyOf.canHandle(step)) {
      const s = genMineAnyOf.create(bot, step, executionContext);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  try {
    if (genMineOneOf && typeof genMineOneOf.canHandle === 'function' && genMineOneOf.canHandle(step)) {
      const s = genMineOneOf.create(bot, step, executionContext);
      if (s) return s;
    }
  } catch (_) {
    // Ignore errors and try next handler
  }

  try {
    if (genMine && typeof genMine.canHandle === 'function' && genMine.canHandle(step)) {
      const s = genMine.create(bot, step, executionContext);
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
 * @param onFinished - Callback to invoke when path execution completes (receives success status)
 * @param executionContext - Optional execution context for runtime interventions
 * @returns NestedStateMachine that executes the entire path
 * 
 * @example
 * const machine = buildStateMachineForPath(bot, path, (success) => {
 *   console.log('Path execution complete!', success);
 * });
 */
export function buildStateMachineForPath(
  bot: Bot,
  pathSteps: ActionPath,
  onFinished?: (success: boolean) => void,
  executionContext?: ExecutionContext
): any {
  const enter = new BehaviorIdle();
  const exit = new BehaviorIdle();
  const transitions: any[] = [];

  let prev: any = enter;
  const shared: SharedState = { failed: false };
  let isFirst = true;
  let index = 0;

  for (const step of pathSteps) {
    let st: any;
    try {
      st = createStateForStep(bot, step, shared, executionContext);
      if (!st) {
        logger.error(`PathBuilder: Failed to create state for step ${index}`);
        shared.failed = true;
        continue;
      }
    } catch (err: any) {
      logger.error(`PathBuilder: Error creating state for step ${index}: ${err.message || err}`);
      shared.failed = true;
      continue;
    }

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
        // Format step.what for logging
        let whatStr: string = String(step.what);
        if (typeof step.what === 'object' && step.what !== null) {
          if ((step.what as any).item) whatStr = (step.what as any).item;
          else if ((step.what as any).name) whatStr = (step.what as any).name;
          else whatStr = JSON.stringify(step.what);
        }
        logger.info(`PathBuilder: step ${stepIndex} -> ${step.action}: ${whatStr}${step.count ? ` x${step.count}` : ''}`);
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
      const success = !shared.failed;
      try {
        if (typeof onFinished === 'function') onFinished(success);
      } catch (err: any) {
        logger.error(`PathBuilder: Error in completion callback: ${err.message || err}`);
      }
    }
  }));

  return new NestedStateMachine(transitions, enter, exit);
}

// Re-export internal function for testing
export const _internals = {
  createStateForStep
};

