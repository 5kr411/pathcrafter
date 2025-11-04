import { BehaviorScheduler } from '../../bots/collector/behavior_scheduler';
import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { createMockBot, createSchedulerHarness } from '../helpers/schedulerTestUtils';

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

describe('unit: ReactiveBehaviorExecutorClass', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  let bot: any;
  let registry: ReactiveBehaviorRegistry;
  let executor: ReactiveBehaviorExecutorClass;
  let scheduler: BehaviorScheduler;

  beforeEach(() => {
    bot = createMockBot();
    registry = new ReactiveBehaviorRegistry();
    executor = new ReactiveBehaviorExecutorClass(bot, registry);
    const harness = createSchedulerHarness(bot);
    scheduler = harness.scheduler;
  });

  test('createScheduledRun returns run and marks executor active', async () => {
    const behavior = {
      name: 'reactive-test',
      priority: 100,
      async execute(_bot: any, exec: { finish: (success: boolean) => void }) {
        exec.finish(true);
        return null;
      }
    };

    const run = executor.createScheduledRun(behavior);
    expect(run).not.toBeNull();
    expect(executor.isActive()).toBe(true);

    scheduler.pushBehavior(run!);
    await scheduler.activateTop();

    await run!.waitForCompletion();
    expect(executor.isActive()).toBe(false);
  });

  test('rejects concurrent runs while one is active', async () => {
    const blockingBehavior = {
      name: 'blocker',
      priority: 100,
      async execute(_bot: any, _exec: { finish: (success: boolean) => void }) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        _exec.finish(true);
        return null;
      }
    };

    const run = executor.createScheduledRun(blockingBehavior);
    expect(run).not.toBeNull();

    scheduler.pushBehavior(run!);
    void scheduler.activateTop();

    const rejected = executor.createScheduledRun(blockingBehavior);
    expect(rejected).toBeNull();

    await run!.waitForCompletion();
    expect(executor.isActive()).toBe(false);
  });

  test('stop aborts the current run', async () => {
    let finished = false;
    const behavior = {
      name: 'abort-test',
      priority: 100,
      async execute(_bot: any, _exec: { finish: (success: boolean) => void }) {
        return {
          update() {
            // no-op
          }
        };
      }
    };

    const run = executor.createScheduledRun(behavior);
    expect(run).not.toBeNull();

    scheduler.pushBehavior(run!);
    await scheduler.activateTop();

    const completion = run!.waitForCompletion().then((result) => {
      finished = result;
    });

    executor.stop();
    await flush();
    await completion;

    expect(finished).toBe(false);
    expect(executor.isActive()).toBe(false);
  });
});
