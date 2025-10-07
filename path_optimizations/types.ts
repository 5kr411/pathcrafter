/**
 * Type definitions for path optimization system
 */

import { ActionStep, VariantGroup } from '../action_tree/types';

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
  what: VariantGroup<string>;
  count: number;
  targetItem?: VariantGroup<string>;
  tool?: VariantGroup<string>;
}

