let stuckDetectionWindowMs = 10000;

export function getStuckDetectionWindowMs(): number {
  return stuckDetectionWindowMs;
}

export function setStuckDetectionWindowMs(ms: number): void {
  if (Number.isFinite(ms) && ms >= 1000) {
    stuckDetectionWindowMs = Math.floor(ms);
  }
}
