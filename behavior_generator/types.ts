/**
 * Type definitions for behavior generator system
 */

import { ActionStep } from '../action_tree/types';

/**
 * Bot interface (simplified mineflayer bot)
 */
export interface Bot {
  inventory?: any;
  pathfinder?: any;
  version?: string;
  entity?: any;
  [key: string]: any;
}

/**
 * Generic behavior state interface
 */
export interface BehaviorState {
  isFinished: () => boolean;
  [key: string]: any;
}

/**
 * Handler for a specific action type
 */
export interface ActionHandler {
  canHandle: (step: ActionStep) => boolean;
  create: (bot: Bot, step: ActionStep) => BehaviorState | null;
  [key: string]: any;
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
 * Shared state between behavior steps
 */
export interface SharedState {
  [key: string]: any;
}

