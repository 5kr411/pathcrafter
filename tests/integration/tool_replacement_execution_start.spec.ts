import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
import { createMockBot, TestWorkerManager } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');
const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');

const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const config = {
  snapshotRadii: [32],
  snapshotYHalf: null,
  pruneWithWorld: true,
  combineSimilarNodes: false,
  perGenerator: 1,
  toolDurabilityThreshold: 0.1
};

async function waitForPlanningRequest(
  workerManager: TestWorkerManager,
  executor: ToolReplacementExecutor,
  toolName: string,
  retries = 10
): Promise<{ id: string } | null> {
  for (let i = 0; i < retries; i += 1) {
    const record = workerManager.findByItem(toolName);
    if (record) {
      return { id: record.id };
    }
    executor.update();
    // eslint-disable-next-line no-await-in-loop
    await flushPromises();
  }
  return null;
}

describe('ToolReplacementExecutor execution startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls onStateEntered on the path machine so execution can progress', async () => {
    const bot = createMockBot();
    let currentInventory: any[] = [];
    bot.inventory.items.mockImplementation(() => currentInventory);
    bot.registry.items = {
      257: { maxDurability: 250 }
    };

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 32 } });

    let started = false;
    let finished = false;
    const onStateEntered = jest.fn();

    (buildStateMachineForPath as jest.Mock).mockImplementation(
      (_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
        return {
          onStateEntered: () => {
            started = true;
            onStateEntered();
          },
          update: () => {
            if (!started || finished) return;
            finished = true;
            if (onFinished) onFinished(true);
          },
          onStateExited: jest.fn()
        };
      }
    );

    const workerManager: TestWorkerManager = new TestWorkerManager();
    const executor = new ToolReplacementExecutor(bot, workerManager as any, () => {}, config);
    executor.onStateEntered();

    const resultPromise = executor.executeReplacement('iron_pickaxe');
    await flushPromises();

    const request = await waitForPlanningRequest(workerManager, executor, 'iron_pickaxe');
    expect(request).not.toBeNull();

    workerManager.resolve(request!.id, [[{ action: 'mock-step' }]]);

    currentInventory = [{ name: 'iron_pickaxe', type: 257, count: 1, durabilityUsed: 0 }];

    for (let i = 0; i < 6; i += 1) {
      executor.update();
      // eslint-disable-next-line no-await-in-loop
      await flushPromises();
    }

    expect(onStateEntered).toHaveBeenCalled();
    await expect(resultPromise).resolves.toBe(true);
  });
});
