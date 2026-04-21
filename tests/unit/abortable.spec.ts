import { withTimeout, isTimeoutAbort } from '../../utils/abortable';

describe('withTimeout', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('signal fires when parent aborts', () => {
    const parent = new AbortController();
    const { signal, cleanup } = withTimeout(parent.signal, 10_000);
    expect(signal.aborted).toBe(false);
    parent.abort();
    expect(signal.aborted).toBe(true);
    expect(isTimeoutAbort(signal)).toBe(false);
    cleanup();
  });

  test('signal fires when timeout elapses', () => {
    const parent = new AbortController();
    const { signal, cleanup } = withTimeout(parent.signal, 1_000);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1_001);
    expect(signal.aborted).toBe(true);
    expect(isTimeoutAbort(signal)).toBe(true);
    cleanup();
  });

  test('cleanup is idempotent', () => {
    const parent = new AbortController();
    const { cleanup } = withTimeout(parent.signal, 1_000);
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  test('isTimeoutAbort returns false for a non-aborted signal', () => {
    const parent = new AbortController();
    const { signal, cleanup } = withTimeout(parent.signal, 1_000);
    expect(isTimeoutAbort(signal)).toBe(false);
    cleanup();
  });

  test('parent abort first keeps isTimeoutAbort false', () => {
    const parent = new AbortController();
    const { signal, cleanup } = withTimeout(parent.signal, 5_000);
    parent.abort();
    jest.advanceTimersByTime(10_000);
    expect(signal.aborted).toBe(true);
    expect(isTimeoutAbort(signal)).toBe(false);
    cleanup();
  });
});
