/**
 * Hunt action handler for the behavior generator
 * 
 * Handles creation of hunting behaviors for mob drops.
 * Uses behaviorHuntEntity to execute the hunt.
 */

import { ActionStep } from '../action_tree/types';
import { Bot, BehaviorState } from './types';

import createHuntEntityState from '../behaviors/behaviorHuntEntity';
import logger from '../utils/logger';

/**
 * Targets for hunting action
 */
export interface HuntTargets {
  entityName: string;
  targetItem: string;
  amount: number;
  dropChance?: number;
}

/**
 * Checks if this handler can process the given step
 * @param step - Action step to check
 * @returns true if this is a hunt action
 */
export function canHandle(step: ActionStep | null | undefined): boolean {
  return !!step && step.action === 'hunt';
}

/**
 * Computes hunting targets from an action step
 * @param step - Hunt action step
 * @returns Hunting targets or null if invalid
 */
export function computeTargetsForHunt(step: ActionStep): HuntTargets | null {
  if (!canHandle(step)) return null;

  const entityVariants = step.what?.variants;
  if (!entityVariants || entityVariants.length === 0) return null;
  
  const entityName = entityVariants[0].value;
  const amount = Number(step.count || 1);
  
  const targetItemVariants = (step as any).targetItem?.variants;
  const targetItem = targetItemVariants && targetItemVariants.length > 0 
    ? targetItemVariants[0].value 
    : entityName;
  
  const dropChanceVariants = (step as any).dropChance?.variants;
  const dropChance = dropChanceVariants && dropChanceVariants.length > 0
    ? dropChanceVariants[0].value
    : undefined;

  if (!entityName || amount <= 0) return null;

  return {
    entityName,
    targetItem,
    amount,
    dropChance
  };
}

/**
 * Creates a behavior state for hunting
 * @param bot - Mineflayer bot instance
 * @param step - Hunt action step
 * @returns Behavior state that hunts the specified entity
 */
export function create(bot: Bot, step: ActionStep): BehaviorState | null {
  const t = computeTargetsForHunt(step);
  if (!t) return null;

  const targets: any = {
    entity: null,
    entityFilter: (entity: any) => {
      if (!entity || !entity.name) return false;
      const name = (entity.name || '').toLowerCase();
      const displayName = (entity.displayName || '').toLowerCase();
      const targetName = t.entityName.toLowerCase();
      return name === targetName || displayName === targetName;
    },
    detectionRange: 48,
    attackRange: 3.0,
    followRange: 2.0
  };

  try {
    logger.info(`BehaviorGenerator(hunt): targets -> entity=${t.entityName}, targetItem=${t.targetItem}, amount=${t.amount}`);
    return createHuntEntityState(bot as any, targets);
  } catch (err) {
    logger.error('BehaviorGenerator(hunt): falling back to no-op behavior', err);
    return { isFinished: () => true };
  }
}

