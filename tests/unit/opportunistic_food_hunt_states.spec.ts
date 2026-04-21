jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLevel: jest.fn()
}));

import {
  BehaviorHuntWithTimeout,
  HUNT_TIMEOUT_MS
} from '../../bots/collector/reactive_behaviors/opportunistic_food_hunt_states';

function makeInner() {
  return {
    stateName: 'HuntInner',
    active: false,
    onStateEntered: jest.fn(),
    onStateExited: jest.fn(),
    update: jest.fn(),
    isFinished: jest.fn(() => false)
  };
}

describe('unit: BehaviorHuntWithTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('calls inner.onStateEntered on entry exactly once', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);

    behavior.onStateEntered();

    expect(inner.onStateEntered).toHaveBeenCalledTimes(1);
    expect(behavior.active).toBe(true);
  });

  test('delegates update() to inner while active', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    behavior.update();
    behavior.update();

    expect(inner.update).toHaveBeenCalledTimes(2);
  });

  test('update() is a no-op after onStateExited', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();
    behavior.onStateExited();

    behavior.update();

    expect(inner.update).not.toHaveBeenCalled();
  });

  test('does NOT forward onStateExited to inner', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    behavior.onStateExited();

    expect(inner.onStateExited).not.toHaveBeenCalled();
  });

  test('innerFinished() reflects inner.isFinished()', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    expect(behavior.innerFinished()).toBe(false);
    inner.isFinished.mockReturnValue(true);
    expect(behavior.innerFinished()).toBe(true);
  });

  test('timedOut() returns false before HUNT_TIMEOUT_MS', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    jest.advanceTimersByTime(HUNT_TIMEOUT_MS - 100);

    expect(behavior.timedOut()).toBe(false);
  });

  test('timedOut() returns true after HUNT_TIMEOUT_MS', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 10);

    expect(behavior.timedOut()).toBe(true);
  });

  test('timedOut() returns false when not active', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();
    jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 10);
    behavior.onStateExited();

    expect(behavior.timedOut()).toBe(false);
  });

  test('markTimedOut() + didTimeout() flag is set by external caller', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    expect(behavior.didTimeout()).toBe(false);
    behavior.markTimedOut();
    expect(behavior.didTimeout()).toBe(true);
  });

  test('update() eagerly sets didTimeout when wall-clock exceeds HUNT_TIMEOUT_MS', () => {
    // Regression guard for the complete-vs-timeout tie-break: if the
    // wall clock has passed HUNT_TIMEOUT_MS, update() sets didTimeout
    // regardless of whether the transition to the timeout exit ever
    // actually fires. This preserves pre-refactor semantics that
    // treated the deadline as authoritative over a coincident inner
    // NSM completion.
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 10);
    behavior.update();

    expect(behavior.didTimeout()).toBe(true);
  });

  test('update() leaves didTimeout false while inside the window', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);
    behavior.onStateEntered();

    jest.advanceTimersByTime(HUNT_TIMEOUT_MS - 100);
    behavior.update();

    expect(behavior.didTimeout()).toBe(false);
  });

  test('re-entry resets startTime and didTimeout', () => {
    const inner = makeInner();
    const behavior = new BehaviorHuntWithTimeout({} as any, inner as any);

    behavior.onStateEntered();
    jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 10);
    behavior.markTimedOut();
    expect(behavior.timedOut()).toBe(true);
    expect(behavior.didTimeout()).toBe(true);

    behavior.onStateExited();
    behavior.onStateEntered();

    expect(behavior.didTimeout()).toBe(false);
    expect(behavior.timedOut()).toBe(false);
  });
});
