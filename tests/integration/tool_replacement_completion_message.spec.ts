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

interface ReplacementScenario {
  startInventory: any[];
  endInventory: any[];
  planSuccess?: boolean;
}

async function runReplacementScenario(scenario: ReplacementScenario): Promise<{ messages: string[]; result: boolean }> {
  const chatMessages: string[] = [];
  const bot = createMockBot();
  let currentInventory = scenario.startInventory;
  const realDateNow = Date.now;
  let fakeNow = realDateNow();

  bot.inventory.items.mockImplementation(() => currentInventory);
  bot.registry.items = {
    871: { maxDurability: 1561 }
  };

  const workerManager: TestWorkerManager = new TestWorkerManager();

  (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 32 } });

  const buildMock = buildStateMachineForPath as jest.Mock;
  buildMock.mockImplementation((_bot: any, _path: any[], onFinished: (success: boolean) => void) => {
    setImmediate(() => onFinished(scenario.planSuccess !== false));
    return {
      update: jest.fn(),
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      transitions: [],
      states: []
    };
  });

  const executor = new ToolReplacementExecutor(bot, workerManager as any, (msg: string) => chatMessages.push(msg), config);
  executor.onStateEntered();

  const resultPromise = executor.executeReplacement('diamond_pickaxe');
  await flush();

  for (let i = 0; i < 3; i += 1) {
    executor.update();
    // eslint-disable-next-line no-await-in-loop
    await flush();
  }

  const request = workerManager.findByItem('diamond_pickaxe');
  expect(request).not.toBeNull();

  currentInventory = scenario.endInventory;
  workerManager.resolve(request!.id, [[{ action: 'mock-step' }]]);

  Date.now = () => fakeNow;
  try {
    for (let i = 0; i < 10; i += 1) {
      fakeNow += 300;
      executor.update();
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }

    const result = await resultPromise;
    return { messages: chatMessages, result };
  } finally {
    Date.now = realDateNow;
  }
}

describe('Tool Replacement Completion Messaging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('announces total gain when inventory increases from 0 to 2', async () => {
    const { messages, result } = await runReplacementScenario({
      startInventory: [],
      endInventory: [
        { name: 'diamond_pickaxe', type: 871, count: 2, durabilityUsed: 0 }
      ]
    });

    expect(result).toBe(true);
    expect(messages).toContain('collected diamond_pickaxe x2');
  });

  it('announces incremental gain when inventory increases from 1 to 2', async () => {
    const { messages, result } = await runReplacementScenario({
      startInventory: [
        { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 1500 }
      ],
      endInventory: [
        { name: 'diamond_pickaxe', type: 871, count: 2, durabilityUsed: 0 }
      ]
    });

    expect(result).toBe(true);
    expect(messages).toContain('collected diamond_pickaxe x1');
  });

  it('returns false and emits no message when inventory does not change', async () => {
    const { messages, result } = await runReplacementScenario({
      startInventory: [],
      endInventory: [],
      planSuccess: true
    });

    expect(result).toBe(false);
    expect(messages).toHaveLength(0);
  });

  it('announces collection even if execution reports failure but inventory is satisfied', async () => {
    const { messages, result } = await runReplacementScenario({
      startInventory: [
        { name: 'diamond_pickaxe', type: 871, count: 1, durabilityUsed: 1500 }
      ],
      endInventory: [
        { name: 'diamond_pickaxe', type: 871, count: 2, durabilityUsed: 0 }
      ],
      planSuccess: false
    });

    expect(result).toBe(true);
    expect(messages).toContain('collected diamond_pickaxe x1');
  });
});
