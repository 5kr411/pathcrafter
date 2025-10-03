/**
 * Type definitions for path optimization system
 */

import { ActionStep } from '../action_tree/types';

/**
 * Mining key used to identify identical mining operations
 */
export interface MiningKey {
  what: string | null;
  target: string | null;
  tool: string | null;
}

/**
 * Mining step (subset of ActionStep specific to mining)
 */
export interface MiningStep extends ActionStep {
  action: 'mine';
  what: string;
  count: number;
  targetItem?: string;
  tool?: string;
}

