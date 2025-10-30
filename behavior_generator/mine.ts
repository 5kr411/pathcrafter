import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, MineTargets } from './types';
import { ExecutionContext } from '../bots/collector/execution_context';

import createCollectBlockState from '../behaviors/behaviorCollectBlock';
import logger from '../utils/logger';

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is a leaf mine action without variants
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  // Accept direct mine steps with concrete block names (leaf mine actions under OR groups)
  // BUT NOT if they have variants - those should be handled by mineOneOf
  return !!step && 
         step.action === 'mine' && 
         step.what.variants.length === 1 && 
         (!('operator' in step) || !('children' in step) || !(step as any).children || (step as any).children.length === 0);
}

/**
 * Computes mining targets from an action step
 * @param step - Mine action step
 * @returns Mining targets or null if invalid
 */
export function computeTargetsForMine(step: ActionStep): MineTargets | null {
  if (!canHandle(step)) return null;

  // If step has a targetItem, we want that item name in inventory; otherwise, mining the block drops itself
  const targetItem = step.targetItem ? step.targetItem.variants[0].value : undefined;
  const blockName = step.what.variants[0].value;
  const itemName = targetItem ? targetItem : blockName;
  const amount = Number(step.count || 1);

  if (!itemName || amount <= 0) return null;

  return { 
    itemName, 
    amount, 
    blockName 
  };
}

/**
 * Creates a behavior state for mining
 * @param bot - Mineflayer bot instance
 * @param step - Mine action step
 * @param executionContext - Optional execution context for runtime interventions
 * @returns Behavior state that mines the specified block
 */
export function create(bot: Bot, step: ActionStep, executionContext?: ExecutionContext): BehaviorState | null {
  const t = computeTargetsForMine(step);
  if (!t) return null;

  const targets = { 
    itemName: t.itemName, 
    amount: t.amount, 
    blockName: t.blockName,
    executionContext
  };

  try {
    logger.info(`BehaviorGenerator(mine): targets -> block=${targets.blockName}, item=${targets.itemName}, amount=${targets.amount}`);
    return createCollectBlockState(bot as any, targets as any);
  } catch (err) {
    logger.error('BehaviorGenerator(mine): falling back to no-op behavior in test context', err);
    return { isFinished: () => true };
  }
}

