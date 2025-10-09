/**
 * Type definitions for path generator system
 */

import { ActionPath, ActionStep } from '../action_tree/types';

/**
 * Options for path generation
 */
export interface GeneratorOptions {
  inventory?: Map<string, number>;
  worldSnapshot?: WorldSnapshot;
  [key: string]: any;
}

/**
 * World snapshot for distance scoring
 */
export interface WorldSnapshot {
  blocks?: {
    [blockName: string]: {
      averageDistance?: number;
      count?: number;
    };
  };
  entities?: {
    [entityName: string]: {
      averageDistance?: number;
      count?: number;
    };
  };
}

/**
 * Path item with metadata
 */
export interface PathItem {
  path: ActionPath;
  [key: string]: any;
}

/**
 * Path item with weight
 */
export interface WeightedPathItem extends PathItem {
  weight: number;
}

/**
 * Path item with length
 */
export interface LengthPathItem extends PathItem {
  length: number;
}

/**
 * Generator function that yields paths
 */
export type PathGenerator = Generator<ActionPath, void, unknown>;

/**
 * Stream function that yields path items
 */
export type StreamFunction<T = PathItem> = () => Generator<T, void, unknown>;

/**
 * Function to create a leaf stream from a step
 */
export type MakeLeafStreamFn<T = PathItem> = (step: ActionStep) => StreamFunction<T>;

/**
 * Function to create an OR stream from child streams
 */
export type MakeOrStreamFn<T = PathItem> = (childStreams: StreamFunction<T>[]) => StreamFunction<T>;

/**
 * Function to create an AND stream from child streams and optional parent step
 */
export type MakeAndStreamFn<T = PathItem> = (
  childStreams: StreamFunction<T>[],
  parentStepOrNull: ActionStep | null
) => StreamFunction<T>;

/**
 * Enumerator context for path generation
 */
export interface EnumeratorContext {
  initialSupply: Map<string, number>;
  createMakeStream: (
    makeLeafStream: MakeLeafStreamFn<any>,
    makeOrStream: MakeOrStreamFn<any>,
    makeAndStream: MakeAndStreamFn<any>
  ) => (tree: any) => StreamFunction<any>;
}

/**
 * Priority stream configuration
 */
export interface PriorityStreamConfig {
  getItemScore: (item: PathItem) => number;
  getParentStepScore: (step: ActionStep | null) => number;
  finalizeItem: (cleanedPath: ActionPath) => PathItem;
}

/**
 * Job configuration for worker threads
 */
export interface EnumeratorJob {
  generator: 'action' | 'shortest' | 'lowest';
  tree: any;
  inventory?: Record<string, number>;
  limit: number;
}

/**
 * Worker message types
 */
export interface WorkerMessage {
  type: 'enumerate' | 'result';
  ok?: boolean;
  paths?: ActionPath[];
  generator?: string;
  tree?: any;
  inventory?: Record<string, number>;
  limit?: number;
}

