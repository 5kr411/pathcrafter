import { TargetExecutor } from '../../bots/collector/target_executor';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
import { createMockBot, createControlHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

describe('Tool Replacement Pre-emption', () => {
  const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');
  const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  let bot: any;
  let workerManager: TestWorkerManager;
  let targetExecutor: TargetExecutor;
  let toolReplacementExecutor: ToolReplacementExecutor;
  let safeChat: jest.Mock;
  let controlStack: any;

  const config = {
    snapshotRadii: [32],
    snapshotYHalf: null,
    pruneWithWorld: true,
    combineSimilarNodes: false,
    perGenerator: 1,
    toolDurabilityThreshold: 0.3
  };

  beforeEach(() => {
    jest.clearAllMocks();

    bot = createMockBot();
    bot.inventory.items.mockReturnValue([
      { name: 'iron_pickaxe', type: 257, count: 1, durabilityUsed: 150 }
    ]);
    bot.registry.items = {
      257: { maxDurability: 250 }
    };

    safeChat = jest.fn();
    bot.safeChat = safeChat;

    const harness = createControlHarness(bot, { config });
    workerManager = harness.workerManager;
    controlStack = harness.controlStack;
    targetExecutor = controlStack.targetLayer;
    toolReplacementExecutor = controlStack.toolLayer;
    controlStack.start();

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 16 } });
  });

  it('suspends target execution while tool replacement runs and resumes afterwards', async () => {
    const buildStateMachineForPathMock = buildStateMachineForPath as jest.Mock;

    let targetTicks = 0;
    buildStateMachineForPathMock.mockImplementationOnce((_bot: any, _path: any[], _onFinished: (success: boolean) => void) => {
      return {
        update: () => {
          targetTicks += 1;
        },
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
    });

    let toolTicks = 0;
    buildStateMachineForPathMock.mockImplementationOnce((_bot: any, _path: any[], onFinished: (success: boolean) => void) => {
      return {
        update: () => {
          toolTicks += 1;
          if (toolTicks >= 3) {
            onFinished(true);
          }
        },
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      };
    });

    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();

    let targetRequest = null;
    for (let i = 0; i < 5; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flush();
      targetRequest = workerManager.findByItem('oak_log');
      if (targetRequest) break;
    }
    expect(targetRequest).not.toBeNull();
    workerManager.resolve(targetRequest!.id, [[{ action: 'mock-step' }]]);

    for (let i = 0; i < 3; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    expect(targetTicks).toBeGreaterThanOrEqual(1);

    const replacementPromise = toolReplacementExecutor.executeReplacement('iron_pickaxe');
    await flush();

    let replacementRequest = null;
    for (let i = 0; i < 5; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flush();
      replacementRequest = workerManager.findByItem('iron_pickaxe');
      if (replacementRequest) break;
    }
    expect(replacementRequest).not.toBeNull();
    workerManager.resolve(replacementRequest!.id, [[{ action: 'replace-tool' }]]);
    bot.inventory.items.mockReturnValue([
      { name: 'iron_pickaxe', type: 257, count: 2, durabilityUsed: 0 }
    ]);

    const targetTicksBefore = targetTicks;
    let replacementResolved = false;
    replacementPromise.then(() => {
      replacementResolved = true;
    });

    for (let i = 0; i < 10; i += 1) {
      bot.emit('physicTick');
      await flush();
      if (replacementResolved) break;
    }

    expect(toolTicks).toBeGreaterThanOrEqual(3);
    expect(targetTicks).toBeLessThanOrEqual(targetTicksBefore + 1);

    if (!replacementResolved) {
      throw new Error('tool replacement did not resolve');
    }
    await replacementPromise;

    for (let i = 0; i < 5; i += 1) {
      bot.emit('physicTick');
      await flush();
    }

    expect(toolReplacementExecutor.isActive()).toBe(false);
    expect(targetTicks).toBeGreaterThan(targetTicksBefore);
  });
});
