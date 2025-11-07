import { BehaviorScheduler } from '../../bots/collector/behavior_scheduler';
import { TargetExecutor } from '../../bots/collector/target_executor';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { createMockBot, createSchedulerHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

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

describe('Reactive Behavior Pre-emption', () => {
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

    const harness = createSchedulerHarness(bot);
    scheduler = harness.scheduler;
    workerManager = harness.workerManager;

    reactiveExecutor = new ReactiveBehaviorExecutorClass(bot, new ReactiveBehaviorRegistry());
    toolReplacementExecutor = new ToolReplacementExecutor(bot, workerManager as any, scheduler, safeChat, config);
    targetExecutor = new TargetExecutor(bot, workerManager as any, safeChat, config, reactiveExecutor, toolReplacementExecutor);

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 16 } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('suspends target execution while reactive behavior runs and resumes afterwards', async () => {
    const buildStateMachineForPathMock = buildStateMachineForPath as jest.Mock;

    let targetTicks = 0;
    buildStateMachineForPathMock.mockImplementation((_bot: any, _path: any[], _onFinished: (success: boolean) => void) => {
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

    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    scheduler.pushBehavior(targetExecutor);
    await scheduler.activateTop();

    const targetRequest = workerManager.findByItem('oak_log');
    expect(targetRequest).not.toBeNull();
    workerManager.resolve(targetRequest!.id, [[{ action: 'mock-step' }]]);

    bot.emit('physicTick');
    bot.emit('physicTick');
    expect(targetTicks).toBeGreaterThanOrEqual(2);

    let reactiveTicks = 0;
    let finished = false;
    const behavior = {
      priority: 100,
      name: 'hostile-mob',
      shouldActivate: async () => true,
      execute: async (_: any, executor: { finish: (success: boolean) => void }) => {
        return {
          update: () => {
            if (finished) return;
            reactiveTicks += 1;
            if (reactiveTicks >= 5) {
              finished = true;
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

    const run = await reactiveExecutor.createScheduledRun(behavior);
    expect(run).not.toBeNull();

    const reactivePromise = (async () => {
      await scheduler.pushAndActivate(run!, 'reactive-behavior');
      await run!.waitForCompletion();
    })();

    await flush();

    const targetTicksBefore = targetTicks;

    while (!finished) {
      bot.emit('physicTick');
      await flush();
    }

    await reactivePromise;

    expect(reactiveTicks).toBeGreaterThanOrEqual(5);
    expect(targetTicks).toBe(targetTicksBefore);

    bot.emit('physicTick');
    await flush();
    expect(targetTicks).toBeGreaterThan(targetTicksBefore);
  });
});

