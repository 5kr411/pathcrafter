import { StateBehavior } from 'mineflayer-statemachine';
import { Bot } from './types';

export const HUNT_TIMEOUT_MS = 60_000;

/**
 * Wraps the existing `createHuntEntityState` NSM (built inline by
 * `opportunistic_food_hunt_behavior.createState`) and tracks the
 * start time for a wall-clock timeout check.
 *
 * Rather than holding the timeout in a `setTimeout` callback + flag
 * in a closure (as the pre-refactor code did), the timeout is modeled
 * as a transition predicate on the outer NSM — `timedOut()` is true
 * once `HUNT_TIMEOUT_MS` has elapsed, and the outer NSM's timeout
 * transition both fires the exit and calls `markTimedOut()` so
 * `wasSuccessful()` can distinguish completion from abort.
 */
export class BehaviorHuntWithTimeout implements StateBehavior {
  public stateName = 'HuntWithTimeout';
  public active = false;
  private startTime = 0;
  private _didTimeout = false;

  /**
   * @param bot reactive bot reference (unused today, reserved for
   *            future observability hooks that might need bot state)
   * @param inner NSM (StateBehavior) produced by createHuntEntityState
   */
  constructor(
    _bot: Bot,
    private readonly inner: StateBehavior & { isFinished?: () => boolean }
  ) {}

  onStateEntered(): void {
    this.active = true;
    this.startTime = Date.now();
    this._didTimeout = false;
    if (typeof this.inner.onStateEntered === 'function') {
      this.inner.onStateEntered();
    }
  }

  onStateExited(): void {
    this.active = false;
    // The inner NSM's exit fires through its own transition chain;
    // we intentionally do NOT forward onStateExited here. Once the
    // outer-NSM timeout transition fires, the inner's active sub-state
    // stays where it was — safe because the reactive executor will
    // throw away this whole state bundle on the next createState call.
  }

  update(): void {
    if (!this.active) return;
    if (typeof this.inner.update === 'function') {
      this.inner.update();
    }
    // Preserve pre-refactor semantics: wall-clock overrun = failure,
    // even if the inner NSM happens to complete on the same tick. The
    // outer NSM's transitions are checked in array order with
    // 'complete' first, so without this eager flag, a coincident
    // completion would mask the timeout and flip wasSuccessful() to
    // true. Setting didTimeout here ensures wasSuccessful() reflects
    // wall-clock reality regardless of which transition fires.
    if (this.timedOut()) {
      this._didTimeout = true;
    }
  }

  innerFinished(): boolean {
    return typeof this.inner.isFinished === 'function'
      ? this.inner.isFinished()
      : false;
  }

  timedOut(): boolean {
    return this.active && Date.now() - this.startTime > HUNT_TIMEOUT_MS;
  }

  markTimedOut(): void {
    this._didTimeout = true;
  }

  didTimeout(): boolean {
    return this._didTimeout;
  }
}
