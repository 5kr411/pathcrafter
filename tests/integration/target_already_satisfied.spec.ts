import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

import { captureSnapshotForTarget } from '../../bots/collector/snapshot_manager';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForPlanningRequest(worker: any, bot: any, itemName: string, retries = 10): Promise<any> {
  for (let i = 0; i < retries; i += 1) {
    const record = worker.findByItem(itemName);
    if (record) {
      return record;
    }
    bot.emit('physicTick');
    // eslint-disable-next-line no-await-in-loop
    await flushPromises();
  }
  return null;
}

describe('TargetExecutor already satisfied targets', () => {
  let bot: any;
  let executor: TargetExecutor;
  let workerManager: any;
  let controlStack: any;

  beforeEach(() => {
    jest.clearAllMocks();
    bot = createMockBot();
    const harness = createControlHarness(bot);
    workerManager = harness.workerManager;
    controlStack = harness.controlStack;
    executor = controlStack.targetLayer;
    controlStack.start();

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({
      snapshot: {
        radius: 32,
        blocks: {}
      }
    });
  });

  afterEach(() => {
    controlStack.stop();
  });

  it('completes immediately when the target is already in inventory and plan is empty', async () => {
    bot.inventory.items.mockReturnValue([
      { name: 'diamond_pickaxe', count: 1 }
    ]);

    executor.setTargets([{ item: 'diamond_pickaxe', count: 1 }]);
    await executor.startNextTarget();
    await flushPromises();

    const request = await waitForPlanningRequest(workerManager, bot, 'diamond_pickaxe');
    expect(request).not.toBeNull();
    workerManager.resolve(request.id, [[]]);

    for (let i = 0; i < 4; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flushPromises();
    }

    expect(executor.isRunning()).toBe(false);
    expect(executor.getTargets()).toHaveLength(0);
  });
});
