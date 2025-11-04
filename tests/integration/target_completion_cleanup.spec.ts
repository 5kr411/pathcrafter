import { TargetExecutor } from '../../bots/collector/target_executor';
import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { createMockBot, createSchedulerHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

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

describe('Target completion cleanup', () => {
  let bot: any;
  let workerManager: TestWorkerManager;
  let executor: TargetExecutor;
  let safeChat: jest.Mock;

  const config = {
    snapshotRadii: [32],
    snapshotYHalf: null,
    pruneWithWorld: true,
    combineSimilarNodes: false,
    perGenerator: 1,
    toolDurabilityThreshold: 0.1
  };

  beforeEach(() => {
    bot = createMockBot();
    safeChat = jest.fn();

    const harness = createSchedulerHarness(bot);
    workerManager = harness.workerManager;

    const reactiveExecutor = new ReactiveBehaviorExecutorClass(bot, new ReactiveBehaviorRegistry());

    executor = new TargetExecutor(bot, workerManager as any, safeChat, config, reactiveExecutor, undefined);
  });

  it('clears pending targets and control states after final target completes', async () => {
    executor.setTargets([{ item: 'diamond', count: 1 }]);

    // Simulate completion state
    (executor as any).sequenceTargets = [{ item: 'diamond', count: 1 }];
    (executor as any).sequenceIndex = 1;
    (executor as any).running = false;

    bot.clearControlStates.mockClear();

    await executor['startNextTarget']();

    expect(bot.clearControlStates).toHaveBeenCalled();
    expect(executor.getTargets().length).toBe(0);
    expect((executor as any).running).toBe(false);
  });

  it('stop() clears worker pending requests and control states', () => {
    workerManager.postPlanningRequest(
      'test',
      { item: 'diamond', count: 1 },
      { radius: 32 } as any,
      {},
      '1.20.1',
      1,
      true,
      false
    );

    executor.stop();

    expect(workerManager.drainPending()).toHaveLength(0);
    expect(bot.clearControlStates).toHaveBeenCalled();
    expect(executor.getTargets().length).toBe(0);
  });
});
