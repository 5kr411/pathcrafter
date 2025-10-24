export interface RuntimeConfig {
  pruneWithWorld: boolean;
  perGenerator: number;
  snapshotRadii: number[];
  snapshotYHalf: number | null;
  logLevel: string;
  progressLogIntervalMs: number;
  safeFindRepeatThreshold: number;
  liquidAvoidanceDistance: number;
  usePersistentWorker: boolean;
  combineSimilarNodes: boolean;
}

export interface Target {
  item: string;
  count: number;
}

export interface InventoryObject {
  [itemName: string]: number;
}

export interface Snapshot {
  radius: number;
  blocks?: { [blockName: string]: any };
  entities?: { [entityName: string]: any };
  [key: string]: any;
}

export interface SnapshotOptions {
  radii: number[];
  yMin?: number;
  yMax?: number;
}

export interface AdaptiveSnapshotResult {
  snapshot: Snapshot;
  radiusUsed: number;
  attemptsCount: number;
}

export interface WorkerMessage {
  type: string;
  id?: string;
  ok?: boolean;
  error?: string;
  ranked?: any[];
  [key: string]: any;
}

export interface PendingEntry {
  snapshot: Snapshot;
  target: Target;
}

export type Bot = any;

const RUNTIME: RuntimeConfig = {
  pruneWithWorld: true,
  perGenerator: 1000,
  snapshotRadii: [32, 64, 96, 128],
  snapshotYHalf: null,
  logLevel: 'DEBUG',
  progressLogIntervalMs: 250,
  safeFindRepeatThreshold: 10,
  liquidAvoidanceDistance: 3,
  usePersistentWorker: true,
  combineSimilarNodes: true
};

export function getConfig(): RuntimeConfig {
  return RUNTIME;
}

export function getSnapshotRadii(): number[] {
  return RUNTIME.snapshotRadii;
}

export function getPruneWithWorld(): boolean {
  return RUNTIME.pruneWithWorld;
}

export function getPerGenerator(): number {
  return RUNTIME.perGenerator;
}

export function getCombineSimilarNodes(): boolean {
  return RUNTIME.combineSimilarNodes;
}

