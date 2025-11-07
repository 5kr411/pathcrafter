import { BehaviorScheduler } from '../../bots/collector/behavior_scheduler';
import { TargetExecutor } from '../../bots/collector/target_executor';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
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
  let scheduler: BehaviorScheduler;
  let workerManager: TestWorkerManager;
  let targetExecutor: TargetExecutor;
  let toolReplacementExecutor: ToolReplacementExecutor;
  let reactiveExecutor: ReactiveBehaviorExecutorClass;
  let safeChat: jest.Mock;
  let inventoryPhase: 'before' | 'after';

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

    const harness = createSchedulerHarness(bot);
    scheduler = harness.scheduler;
    workerManager = harness.workerManager;

    reactiveExecutor = new ReactiveBehaviorExecutorClass(bot, new ReactiveBehaviorRegistry());
    toolReplacementExecutor = new ToolReplacementExecutor(bot, workerManager as any, scheduler, safeChat, config);
    targetExecutor = new TargetExecutor(bot, workerManager as any, safeChat, config, reactiveExecutor, toolReplacementExecutor);

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
    scheduler.pushBehavior(targetExecutor);
    await scheduler.activateTop();

    const targetRequest = workerManager.findByItem('oak_log');
    expect(targetRequest).not.toBeNull();
    workerManager.resolve(targetRequest!.id, [[{ action: 'mine' }]]);

    bot.emit('physicTick');
    bot.emit('physicTick');
    expect(targetTicks).toBeGreaterThanOrEqual(2);

    const replacementPromise = toolReplacementExecutor.executeReplacement('iron_pickaxe');
    await flush();

    const toolRequest = workerManager.findByItem('iron_pickaxe');
    expect(toolRequest).not.toBeNull();
    workerManager.resolve(toolRequest!.id, [[{ action: 'replace' }]]);
    inventoryPhase = 'after';

    let reactiveTicks = 0;
    let reactiveFinished = false;
    const reactiveBehavior = {
      priority: 200,
      name: 'hostile-mob',
      shouldActivate: async () => true,
      execute: async (_: any, executor: { finish: (success: boolean) => void }) => {
        return {
          update: () => {
            if (reactiveFinished) return;
            reactiveTicks += 1;
            if (reactiveTicks >= 4) {
              reactiveFinished = true;
              executor.finish(true);
            }
          },
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          transitions: [],
          states: []
        };
      }
    };

    const run = await reactiveExecutor.createScheduledRun(reactiveBehavior);
    expect(run).not.toBeNull();

    const reactivePromise = (async () => {
      await scheduler.pushAndActivate(run!, 'reactive-mob');
      await run!.waitForCompletion();
    })();

    await flush();

    const toolTicksBeforeReactive = toolTicks;

    while (!reactiveFinished) {
      bot.emit('physicTick');
      await flush();
    }

    await reactivePromise;

    expect(toolTicks).toBe(toolTicksBeforeReactive);

    for (let i = 0; i < 5; i += 1) {
      bot.emit('physicTick');
      await flush();
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

