import { TreeNode, ActionPath } from '../action_tree/types';
import { WorldSnapshot } from '../utils/worldSnapshotTypes';

/**
 * Message types for worker thread communication
 */

// ============= Enumerator Worker Messages =============

export type GeneratorType = 'action' | 'shortest' | 'lowest';

export interface EnumerateMessage {
  type: 'enumerate';
  generator: GeneratorType;
  tree: TreeNode;
  inventory?: Record<string, number>;
  limit?: number;
}

export interface EnumeratorResultMessage {
  type: 'result';
  ok: boolean;
  paths?: ActionPath[];
  error?: string;
}

export type EnumeratorMessage = EnumerateMessage | EnumeratorResultMessage;

// ============= Planning Worker Messages =============

export interface PlanMessage {
  type: 'plan';
  id: string;
  mcVersion?: string;
  item: string;
  count: number;
  inventory?: Record<string, number>;
  snapshot?: WorldSnapshot;
  perGenerator?: number;
  pruneWithWorld?: boolean;
  telemetry?: boolean;
}

export interface PlanningResultMessage {
  type: 'result';
  id: string;
  ok: boolean;
  ranked?: ActionPath[];
  error?: string;
}

export type PlanningMessage = PlanMessage | PlanningResultMessage;

