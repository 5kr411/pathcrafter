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
import * as genHunt from './hunt';

import logger from '../utils/logger';

/**
 * Formats a human-readable description of a step for log messages.
 * e.g. "step 0 -> craft: table x1 (one_of: oak_planks, spruce_planks)"
 */
function formatStepDescription(step: ActionStep, stepIndex: number): string {
  // Format the "what" target
  let whatStr: string = String(step.what);
  if (typeof step.what === 'object' && step.what !== null) {
    const variants = (step.what as any).variants;
    if (Array.isArray(variants) && variants.length > 0) {
      whatStr = variants.map((v: any) => v.value).filter(Boolean).join(', ');
    } else if ((step.what as any).item) {
      whatStr = (step.what as any).item;
    } else if ((step.what as any).name) {
      whatStr = (step.what as any).name;
    }
  }

  let desc = `step ${stepIndex} -> ${step.action}: ${whatStr}`;
  if (step.count) desc += ` x${step.count}`;

  // Add result item names for craft steps (what's being crafted)
  if (step.result?.variants?.length) {
    const resultItems = step.result.variants
      .map((v: any) => v.value?.item)
      .filter(Boolean);
    const unique = [...new Set(resultItems)];
    if (unique.length > 0 && unique[0] !== whatStr) {
      desc += ` -> ${unique.join('|')}`;
    }
  }

  // Add variant mode + ingredient summary for multi-variant steps
  if (step.ingredients?.variants && step.ingredients.variants.length > 1) {
    const variantItems = step.ingredients.variants.map((v: any) => {
      const ings = v.value || [];
      return ings.map((i: any) => `${i.item}x${i.perCraftCount}`).join('+');
    });
    desc += ` (${step.variantMode}: ${variantItems.slice(0, 3).join(' | ')}`;
    if (variantItems.length > 3) desc += ` | ...${variantItems.length - 3} more`;
    desc += ')';
  }

  return desc;
}

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
    if (genHunt && typeof genHunt.canHandle === 'function' && genHunt.canHandle(step)) {
      const s = genHunt.create(bot, step);
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
  executionContext?: ExecutionContext,
  onStepEntered?: (stepIndex: number) => void
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
      : () => {
          const finished = parent && typeof parent.isFinished === 'function' ? parent.isFinished() : true;
          if (!finished) return false;
          if ((parent as any).stepSucceeded === false) return false;
          return true;
        };

    const stepIndex = index;
    const stepDesc = formatStepDescription(step, stepIndex);

    transitions.push(new StateTransition({
      parent,
      child: st,
      name: `step:${stepIndex}:${step.action}:${step.what}`,
      shouldTransition: should,
      onTransition: () => {
        logger.info(`PathBuilder: ${stepDesc}`);
        if (typeof onStepEntered === 'function') {
          onStepEntered(stepIndex);
        }
      }
    }));

    // Abort plan early if a step failed or a tool issue was detected
    // This prevents cascading failures where subsequent steps consume shared ingredients
    {
      const ctx = executionContext;
      transitions.push(new StateTransition({
        parent: st,
        child: exit,
        name: `step:${stepIndex}:abort-step-failed`,
        shouldTransition: () => {
          const finished = st && typeof st.isFinished === 'function' ? st.isFinished() : true;
          if (!finished) return false;
          return (st as any).stepSucceeded === false || (ctx && ctx.toolIssueDetected);
        },
        onTransition: () => {
          shared.failed = true;
          const reason = (st as any).stepSucceeded === false ? 'step failure' : 'tool issue';
          const failDetail = (st as any).stepFailureReason || '';
          logger.warn(
            `PathBuilder: aborting plan at step ${stepIndex}/${pathSteps.length - 1} due to ${reason}` +
            ` | ${stepDesc}` +
            (failDetail ? ` | reason: ${failDetail}` : '')
          );
          try {
            if (typeof onFinished === 'function') onFinished(false);
          } catch (_) {}
        }
      }));
    }

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

