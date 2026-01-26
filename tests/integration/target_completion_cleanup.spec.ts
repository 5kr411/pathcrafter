import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

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
    bot.safeChat = safeChat;

    const harness = createControlHarness(bot, { config });
    workerManager = harness.workerManager;
    executor = harness.controlStack.targetLayer;
  });

  it('clears pending targets and control states after final target completes', async () => {
    executor.setTargets([{ item: 'diamond', count: 1 }]);

    // Simulate completion state
    (executor as any).sequenceTargets = [{ item: 'diamond', count: 1 }];
    (executor as any).sequenceIndex = 0;
    (executor as any).running = true;
    (executor as any).currentTargetStartInventory = { diamond: 0 };

    bot.clearControlStates.mockClear();
    bot.inventory.items.mockReturnValue([
      { name: 'diamond', type: 870, count: 1 }
    ]);

    executor['handleTargetSuccess']();

    expect(bot.clearControlStates).toHaveBeenCalled();
    expect(executor.getTargets().length).toBe(0);
    expect((executor as any).running).toBe(false);
  });

  it('stop() clears targets and emits a stop message', () => {
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

    expect(executor.getTargets().length).toBe(0);
    expect(executor.isRunning()).toBe(false);
    expect(safeChat).toHaveBeenCalledWith('stopped');
  });
});
