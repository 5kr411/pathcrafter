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
});
