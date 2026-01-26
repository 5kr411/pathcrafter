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

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const config = {
  snapshotRadii: [32],
  snapshotYHalf: null,
  pruneWithWorld: true,
  combineSimilarNodes: false,
  perGenerator: 1,
  toolDurabilityThreshold: 0.1
};

describe('ToolReplacementExecutor routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('announces replacement success after planner result returns', async () => {
    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 32 } });
    (buildStateMachineForPath as jest.Mock).mockImplementation(
      (_bot: any, _path: any[], onFinished: (success: boolean) => void) => {
        setImmediate(() => onFinished(true));
        return {
          update: jest.fn(),
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          transitions: [],
          states: []
        };
      }
    );

    let inventoryPhase: 'before' | 'after' = 'before';
    const bot = createMockBot();
    bot.inventory.items.mockImplementation(() => {
      if (inventoryPhase === 'before') {
        return [
          { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 1551 }
        ];
      }
      return [
        { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 1551 },
        { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 0 }
      ];
    });
    bot.registry.items = {
      871: { maxDurability: 1561 }
    };

    const chatMessages: string[] = [];
    const safeChat = (msg: string) => chatMessages.push(msg);

    const workerManager: TestWorkerManager = new TestWorkerManager();
    const executor = new ToolReplacementExecutor(bot, workerManager as any, safeChat, config);
    executor.onStateEntered();

    const promise = executor.executeReplacement('diamond_pickaxe');
    await flush();

    for (let i = 0; i < 3; i += 1) {
      executor.update();
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }

    const request = workerManager.findByItem('diamond_pickaxe');
    expect(request).not.toBeNull();

    inventoryPhase = 'after';
    workerManager.resolve(request!.id, [[{ action: 'mine', what: 'oak_log', count: 2 }]]);

    for (let i = 0; i < 10; i += 1) {
      executor.update();
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    await expect(promise).resolves.toBe(true);

    expect(chatMessages).toContain('collected diamond_pickaxe x1');
  });
});
