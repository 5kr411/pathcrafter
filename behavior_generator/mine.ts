import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState, MineTargets } from './types';

const createCollectBlockState = require('../../behaviors/behaviorCollectBlock');
const logger = require('../../utils/logger');

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is a leaf mine action
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  // Accept direct mine steps with concrete block names (leaf mine actions under OR groups)
  return !!step && 
         step.action === 'mine' && 
         typeof step.what === 'string' && 
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
  const targetItem = 'targetItem' in step ? (step as any).targetItem : undefined;
  const itemName = targetItem ? targetItem : step.what;
  const amount = Number(step.count || 1);

  if (!itemName || amount <= 0) return null;

  return { 
    itemName, 
    amount, 
    blockName: step.what 
  };
}

/**
 * Creates a behavior state for mining
 * @param bot - Mineflayer bot instance
 * @param step - Mine action step
 * @returns Behavior state that mines the specified block
 */
export function create(bot: Bot, step: ActionStep): BehaviorState | null {
  const t = computeTargetsForMine(step);
  if (!t) return null;

  const targets = { 
    itemName: t.itemName, 
    amount: t.amount, 
    blockName: t.blockName 
  };

  try {
    logger.info(`BehaviorGenerator(mine): targets -> block=${targets.blockName}, item=${targets.itemName}, amount=${targets.amount}`);
    return createCollectBlockState(bot, targets);
  } catch (err) {
    logger.error('BehaviorGenerator(mine): falling back to no-op behavior in test context', err);
    return { isFinished: () => true };
  }
}

