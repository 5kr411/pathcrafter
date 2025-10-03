/**
 * Global configuration for planning and world pruning
 */

let pruneWithWorldEnabled = false;
let defaultPerGeneratorPaths = 50;
let defaultSnapshotChunkRadius = 3;
let planningTelemetryEnabled = false;
let safeFindRepeatThreshold = 3;

export function setPruneWithWorldEnabled(v: boolean): void {
  pruneWithWorldEnabled = !!v;
}

export function getPruneWithWorldEnabled(): boolean {
  return !!pruneWithWorldEnabled;
}

export function setDefaultPerGeneratorPaths(n: number): void {
  if (Number.isFinite(n) && n > 0) {
    defaultPerGeneratorPaths = Math.floor(n);
  }
}

export function getDefaultPerGeneratorPaths(): number {
  return defaultPerGeneratorPaths;
}

export function setDefaultSnapshotChunkRadius(n: number): void {
  if (Number.isFinite(n) && n >= 0 && n <= 8) {
    defaultSnapshotChunkRadius = Math.floor(n);
  }
}

export function getDefaultSnapshotChunkRadius(): number {
  return defaultSnapshotChunkRadius;
}

export function setPlanningTelemetryEnabled(v: boolean): void {
  planningTelemetryEnabled = !!v;
}

export function getPlanningTelemetryEnabled(): boolean {
  return !!planningTelemetryEnabled;
}

export function setSafeFindRepeatThreshold(n: number): void {
  if (Number.isFinite(n) && n >= 1) {
    safeFindRepeatThreshold = Math.floor(n);
  }
}

export function getSafeFindRepeatThreshold(): number {
  return safeFindRepeatThreshold;
}

