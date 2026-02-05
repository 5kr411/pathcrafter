export type FailureResolution =
  | { action: 'retry'; nextRetryCount: number; delayUntil: number }
  | { action: 'skip'; delayUntil: number };

export function resolveTargetFailure(params: {
  retryCount: number;
  maxRetries: number;
  now: number;
  retryDelayMs: number;
  skipDelayMs: number;
}): FailureResolution {
  const { retryCount, maxRetries, now, retryDelayMs, skipDelayMs } = params;
  if (retryCount < maxRetries - 1) {
    return {
      action: 'retry',
      nextRetryCount: retryCount + 1,
      delayUntil: now + retryDelayMs
    };
  }
  return {
    action: 'skip',
    delayUntil: now + skipDelayMs
  };
}

export function isDelayReady(now: number, delayUntil: number): boolean {
  return now >= delayUntil;
}
