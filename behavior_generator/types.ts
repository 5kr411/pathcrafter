/**
 * Type definitions for behavior generator system
 */

import type { Bot as MineflayerBot } from 'mineflayer';
import { ActionStep } from '../action_tree/types';

/**
 * Bot type aliased to the real mineflayer Bot, augmented for plugins
 * in behavior_generator/mineflayer.d.ts.
 */
export type Bot = MineflayerBot;

/**
 * Generic behavior state interface
 */
export interface BehaviorState {
  isFinished: () => boolean;
}

/**
 * Handler for a specific action type
 */
export interface ActionHandler {
  canHandle: (step: ActionStep) => boolean;
  create: (bot: Bot, step: ActionStep) => BehaviorState | null;
}

/**
 * Targets for mining action
 */
export interface MineTargets {
  itemName: string;
  amount: number;
  blockName: string;
}

/**
 * Targets for crafting action
 */
export interface CraftTargets {
  itemName: string;
  amount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- behavior-node runtime context untyped
  placedPosition?: any;
}

/**
 * Targets for smelting action
 */
export interface SmeltTargets {
  itemName: string;
  amount: number;
  inputName: string | null;
  fuelName: string;
}

/**
 * Targets for require action
 */

/**
 * Shared state between behavior steps
 */
export interface SharedState {
  failed?: boolean;
}

