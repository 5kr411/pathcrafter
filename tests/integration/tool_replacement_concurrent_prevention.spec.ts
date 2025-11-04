import { TargetExecutor } from '../../bots/collector/target_executor';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { BehaviorScheduler } from '../../bots/collector/behavior_scheduler';
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
  let scheduler: BehaviorScheduler;
  let targetExecutor: TargetExecutor;
  let toolReplacementExecutor: ToolReplacementExecutor;
  let reactiveExecutor: ReactiveBehaviorExecutorClass;
  let safeChat: jest.Mock;

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

    const harness = createSchedulerHarness(bot);
    scheduler = harness.scheduler;
    workerManager = harness.workerManager;

    reactiveExecutor = new ReactiveBehaviorExecutorClass(bot, new ReactiveBehaviorRegistry());
    toolReplacementExecutor = new ToolReplacementExecutor(bot, workerManager as any, scheduler, safeChat, config);
    targetExecutor = new TargetExecutor(bot, workerManager as any, safeChat, config, reactiveExecutor, toolReplacementExecutor);

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

    scheduler.pushBehavior(targetExecutor);
    await scheduler.activateTop();

    const targetRequest = workerManager.findByItem('oak_log');
    expect(targetRequest).not.toBeNull();
    workerManager.resolve(targetRequest!.id, [[{ action: 'mock-step' }]]);

    bot.emit('physicTick');
    bot.emit('physicTick');
    expect(targetTicks).toBeGreaterThanOrEqual(2);

    const replacementPromise = toolReplacementExecutor.executeReplacement('iron_pickaxe');
    await flush();

    const replacementRequest = workerManager.findByItem('iron_pickaxe');
    expect(replacementRequest).not.toBeNull();
    workerManager.resolve(replacementRequest!.id, [[{ action: 'replace-tool' }]]);

    const targetTicksBefore = targetTicks;

    for (let i = 0; i < 4; i += 1) {
      bot.emit('physicTick');
      await flush();
    }

    expect(toolTicks).toBeGreaterThanOrEqual(3);
    expect(targetTicks).toBe(targetTicksBefore);

    await replacementPromise;

    for (let i = 0; i < 5; i += 1) {
      bot.emit('physicTick');
      await flush();
    }

    expect(scheduler.getActiveFrameId()).toBe((targetExecutor as any).frameId);
  });
});

