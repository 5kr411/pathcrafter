import { TargetExecutor } from '../../bots/collector/target_executor';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
import { ReactiveBehaviorManager } from '../../bots/collector/reactive_behavior_manager';
import { createMockBot, createControlHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

describe('Nested pre-emption stack integrity', () => {
  const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');
  const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  let bot: any;
  let workerManager: TestWorkerManager;
  let targetExecutor: TargetExecutor;
  let toolReplacementExecutor: ToolReplacementExecutor;
  let reactiveManager: ReactiveBehaviorManager;
  let safeChat: jest.Mock;
  let inventoryPhase: 'before' | 'after';
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
    safeChat = jest.fn();
    bot.safeChat = safeChat;

    inventoryPhase = 'before';
    bot.inventory.items.mockImplementation(() => {
      if (inventoryPhase === 'before') {
        return [
          { name: 'iron_pickaxe', type: 257, count: 1, durabilityUsed: 200 }
        ];
      }
      return [
        { name: 'iron_pickaxe', type: 257, count: 2, durabilityUsed: 0 }
      ];
    });
    bot.registry.items = {
      257: { maxDurability: 250 }
    };

    const harness = createControlHarness(bot, { config });
    workerManager = harness.workerManager;
    controlStack = harness.controlStack;
    targetExecutor = controlStack.targetLayer;
    toolReplacementExecutor = controlStack.toolLayer;
    reactiveManager = controlStack.reactiveLayer;
    controlStack.start();

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 16 } });
  });

  it('handles reactive > tool replacement > target stack without concurrent updates', async () => {
    const buildStateMachineForPathMock = buildStateMachineForPath as jest.Mock;

    let targetTicks = 0;
    buildStateMachineForPathMock.mockImplementationOnce((_bot: any, _path: any[], _onFinished: (success: boolean) => void) => ({
      update: () => {
        targetTicks += 1;
      },
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      transitions: [],
      states: []
    }));

    let toolTicks = 0;
    buildStateMachineForPathMock.mockImplementationOnce((_bot: any, _path: any[], onFinished: (success: boolean) => void) => ({
      update: () => {
        toolTicks += 1;
        if (toolTicks >= 5) {
          onFinished(true);
        }
      },
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      transitions: [],
      states: []
    }));

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
    workerManager.resolve(targetRequest!.id, [[{ action: 'mine' }]]);

    for (let i = 0; i < 3; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    expect(targetTicks).toBeGreaterThanOrEqual(1);

    const replacementPromise = toolReplacementExecutor.executeReplacement('iron_pickaxe');
    await flush();

    let toolRequest = null;
    for (let i = 0; i < 5; i += 1) {
      bot.emit('physicTick');
      // eslint-disable-next-line no-await-in-loop
      await flush();
      toolRequest = workerManager.findByItem('iron_pickaxe');
      if (toolRequest) break;
    }
    expect(toolRequest).not.toBeNull();
    workerManager.resolve(toolRequest!.id, [[{ action: 'replace' }]]);
    inventoryPhase = 'after';

    let reactiveTicks = 0;
    let reactiveFinished = false;
    let allowReactive = false;
    const reactiveBehavior = {
      priority: 200,
      name: 'hostile-mob',
      shouldActivate: async () => allowReactive,
      createState: async () => {
        const stateMachine: any = {
          update: () => {
            if (reactiveFinished) return;
            reactiveTicks += 1;
            if (reactiveTicks >= 4) {
              reactiveFinished = true;
              allowReactive = false;
            }
          },
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          transitions: [],
          states: [],
          isFinished: () => reactiveFinished,
          wasSuccessful: () => true
        };
        return { stateMachine };
      }
    };

    reactiveManager.setEnabled(true);
    reactiveManager.registry.register(reactiveBehavior as any);
    allowReactive = true;

    await flush();

    const toolTicksBeforeReactive = toolTicks;
    let replacementResolved = false;
    replacementPromise.then(() => {
      replacementResolved = true;
    });

    while (!reactiveFinished) {
      bot.emit('physicTick');
      await flush();
    }

    expect(toolTicks).toBeLessThanOrEqual(toolTicksBeforeReactive + 1);

    for (let i = 0; i < 10; i += 1) {
      bot.emit('physicTick');
      await flush();
      if (replacementResolved) break;
    }

    if (!replacementResolved) {
      throw new Error('tool replacement did not resolve');
    }
    await replacementPromise;

    for (let spin = 0; spin < 8 && toolReplacementExecutor.isActive(); spin += 1) {
      await flush();
    }
    expect(toolReplacementExecutor.isActive()).toBe(false);

    const targetTicksDuringReactiveAndTool = targetTicks;
    bot.emit('physicTick');
    await flush();
    expect(targetTicks).toBeGreaterThan(targetTicksDuringReactiveAndTool);
  });
});
