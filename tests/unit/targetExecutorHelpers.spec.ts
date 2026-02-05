import { isDelayReady, resolveTargetFailure } from '../../bots/collector/targetExecutorHelpers';

describe('targetExecutorHelpers', () => {
  it('resolves retry when under max retries', () => {
    const result = resolveTargetFailure({
      retryCount: 0,
      maxRetries: 5,
      now: 1000,
      retryDelayMs: 2000,
      skipDelayMs: 1000
    });

    expect(result.action).toBe('retry');
    if (result.action === 'retry') {
      expect(result.nextRetryCount).toBe(1);
      expect(result.delayUntil).toBe(3000);
    }
  });

  it('resolves skip when max retries reached', () => {
    const result = resolveTargetFailure({
      retryCount: 4,
      maxRetries: 5,
      now: 5000,
      retryDelayMs: 2000,
      skipDelayMs: 1000
    });

    expect(result.action).toBe('skip');
    if (result.action === 'skip') {
      expect(result.delayUntil).toBe(6000);
    }
  });

  it('isDelayReady returns true when now >= delayUntil', () => {
    expect(isDelayReady(1000, 500)).toBe(true);
    expect(isDelayReady(1000, 1000)).toBe(true);
    expect(isDelayReady(999, 1000)).toBe(false);
  });
});
