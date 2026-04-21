import { ReactiveBehaviorManager } from '../../bots/collector/reactive_behavior_manager';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { ReactiveBehavior } from '../../bots/collector/reactive_behaviors/types';
import { createMockBot } from '../helpers/schedulerTestUtils';

jest.mock('mineflayer-statemachine', () => ({
  BotStateMachine: jest.fn((_bot: any, machine: any) => {
    machine.active = true;
    return {
      stop: jest.fn(() => {
        machine.active = false;
      })
    };
  })
}));

describe('unit: ReactiveBehaviorManager sync startBehavior', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  let bot: any;
  let registry: ReactiveBehaviorRegistry;
  let manager: ReactiveBehaviorManager;

  beforeEach(() => {
    bot = createMockBot();
    registry = new ReactiveBehaviorRegistry();
    manager = new ReactiveBehaviorManager(bot, registry);
    manager.onStateEntered();
  });

  afterEach(() => {
    manager.onStateExited();
  });

  test('sync behavior starts in the same tick as update()', async () => {
    const onStateEntered = jest.fn();

    const behavior: ReactiveBehavior = {
      name: 'sync-test',
      priority: 100,
      shouldActivate: () => true,
      createState: () => ({
        stateMachine: {
          onStateEntered,
          onStateExited: jest.fn(),
          update: jest.fn(),
          isFinished: () => false,
          wasSuccessful: () => true
        }
      })
    };

    registry.register(behavior);

    // First update kicks off evaluation (async) — candidate not yet set.
    manager.update();
    expect(onStateEntered).not.toHaveBeenCalled();

    // Flush the microtask queue so the evaluation promise resolves.
    await flush();

    // Second update picks up the candidate and starts the sync behavior immediately.
    manager.update();
    expect(onStateEntered).toHaveBeenCalledTimes(1);
    expect(manager.isActive()).toBe(true);
  });

  test('async behavior does not permanently block the manager', async () => {
    let resolveCreateState: (value: any) => void;
    const onStateEntered = jest.fn();

    const behavior: ReactiveBehavior = {
      name: 'async-test',
      priority: 100,
      shouldActivate: () => true,
      createState: () =>
        new Promise((resolve) => {
          resolveCreateState = resolve;
        })
    };

    registry.register(behavior);

    manager.update();
    await flush();
    manager.update();

    // Behavior hasn't resolved yet — manager should not crash.
    expect(manager.isActive()).toBe(false);

    // Resolve the async createState.
    resolveCreateState!({
      stateMachine: {
        onStateEntered,
        onStateExited: jest.fn(),
        update: jest.fn(),
        isFinished: () => false,
        wasSuccessful: () => true
      }
    });

    await flush();

    // Now the behavior should be active.
    expect(onStateEntered).toHaveBeenCalledTimes(1);
    expect(manager.isActive()).toBe(true);
  });

  test('sync createState returning null does not crash', async () => {
    const behavior: ReactiveBehavior = {
      name: 'null-state',
      priority: 100,
      shouldActivate: () => true,
      createState: () => null
    };

    registry.register(behavior);

    manager.update();
    await flush();

    // Should not throw.
    expect(() => manager.update()).not.toThrow();
    expect(manager.isActive()).toBe(false);
  });

  test('sync createState that throws does not crash', async () => {
    const behavior: ReactiveBehavior = {
      name: 'throw-state',
      priority: 100,
      shouldActivate: () => true,
      createState: () => {
        throw new Error('boom');
      }
    };

    registry.register(behavior);

    manager.update();
    await flush();

    expect(() => manager.update()).not.toThrow();
    expect(manager.isActive()).toBe(false);
  });

  test('stop() aborts in-flight evaluation and prevents candidate write', async () => {
    let resolveActivate: ((v: boolean) => void) | null = null;
    const behavior: ReactiveBehavior = {
      name: 'slow-eval',
      priority: 100,
      shouldActivate: () => new Promise<boolean>((resolve) => {
        resolveActivate = resolve;
      }),
      createState: () => ({
        stateMachine: {
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          update: jest.fn(),
          isFinished: () => false,
          wasSuccessful: () => true
        }
      })
    };
    registry.register(behavior);

    // Kick off evaluation; let the microtask chain reach shouldActivate().
    manager.update();
    await flush();
    expect(resolveActivate).not.toBeNull();

    // Stop the manager while evaluation is in flight.
    manager.stop();

    // Now resolve the predicate — candidate should NOT be written.
    resolveActivate!(true);
    await flush();
    await flush();

    expect((manager as any).candidate).toBeNull();
    expect(manager.isActive()).toBe(false);
  });

  test('evaluation timeout clears evaluationPromise without writing candidate', async () => {
    jest.useFakeTimers();
    const behavior: ReactiveBehavior = {
      name: 'hanging-eval',
      priority: 100,
      // Never resolves.
      shouldActivate: () => new Promise<boolean>(() => { /* intentionally unresolved */ }),
      createState: () => null
    };
    registry.register(behavior);

    manager.update();
    // Fire the 5s timeout. advanceTimersByTime also drains queued microtasks.
    jest.advanceTimersByTime(5_001);

    // Drop back to real timers and flush the promise chain (abort → catch → finally).
    jest.useRealTimers();
    await flush();
    await flush();

    expect((manager as any).evaluationPromise).toBeNull();
    expect((manager as any).candidate).toBeNull();
    // Controller should be cleared too.
    expect((manager as any).evaluationAbort).toBeNull();
  });
});
