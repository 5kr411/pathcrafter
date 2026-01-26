import { ReactiveBehaviorManager } from '../../bots/collector/reactive_behavior_manager';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
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

describe('unit: ReactiveBehaviorManager', () => {
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

  test('starts and completes a reactive run', async () => {
    let updates = 0;
    let finished = false;

    registry.register({
      name: 'reactive-test',
      priority: 100,
      shouldActivate: () => true,
      createState: async () => {
        const stateMachine: any = {
          update: () => {
            updates += 1;
            if (updates >= 2) {
              finished = true;
            }
          },
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          transitions: [],
          states: [],
          isFinished: () => finished,
          wasSuccessful: () => true
        };
        return { stateMachine };
      }
    });

    manager.update();
    await flush();
    manager.update();
    await flush();

    expect(manager.isActive()).toBe(true);

    manager.update();
    manager.update();
    await flush();
    manager.update();

    expect(manager.isActive()).toBe(false);
    expect(updates).toBeGreaterThan(0);
  });

  test('preempts lower priority behaviors', async () => {
    const stopReasons: string[] = [];
    let lowUpdates = 0;
    let highUpdates = 0;
    let highActive = false;

    registry.register({
      name: 'low',
      priority: 50,
      shouldActivate: () => true,
      createState: async () => {
        let finished = false;
        const stateMachine: any = {
          update: () => {
            lowUpdates += 1;
          },
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          transitions: [],
          states: [],
          isFinished: () => finished,
          wasSuccessful: () => true
        };
        return {
          stateMachine,
          onStop: (reason) => {
            stopReasons.push(reason);
            finished = true;
          }
        };
      }
    });

    registry.register({
      name: 'high',
      priority: 100,
      shouldActivate: () => highActive,
      createState: async () => {
        let ticks = 0;
        let finished = false;
        const stateMachine: any = {
          update: () => {
            highUpdates += 1;
            ticks += 1;
            if (ticks >= 2) {
              finished = true;
            }
          },
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          transitions: [],
          states: [],
          isFinished: () => finished,
          wasSuccessful: () => true
        };
        return { stateMachine };
      }
    });

    manager.update();
    await flush();
    manager.update();
    await flush();
    manager.update();
    expect(lowUpdates).toBeGreaterThan(0);

    highActive = true;
    manager.update();
    await flush();
    manager.update();
    await flush();

    for (let i = 0; i < 4 && highUpdates === 0; i += 1) {
      manager.update();
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }

    expect(stopReasons).toContain('preempted');
    expect(highUpdates).toBeGreaterThan(0);
  });
});
