import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

describe('TargetExecutor no_plan fast-fail', () => {
  const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  const pumpUntilPlanningRequest = async (
    bot: any,
    workerManager: TestWorkerManager,
    item: string,
    maxTicks = 5
  ): Promise<{ id: string } | null> => {
    for (let i = 0; i < maxTicks; i++) {
      const r = workerManager.findByItem(item);
      if (r) return r;
      bot.emit('physicTick');
      await flush();
    }
    return workerManager.findByItem(item);
  };

  let bot: any;
  let workerManager: TestWorkerManager;
  let targetExecutor: TargetExecutor;
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
    safeChat = jest.fn();
    bot.safeChat = safeChat;
    bot.inventory.items.mockReturnValue([]);
    bot.registry.items = {};

    const harness = createControlHarness(bot, { config });
    workerManager = harness.workerManager;
    controlStack = harness.controlStack;
    targetExecutor = controlStack.targetLayer;
    controlStack.start();

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 16 } });
  });

  afterEach(() => {
    try { targetExecutor.onStateExited(); } catch (_) {}
    jest.useRealTimers();
  });

  const pumpTicks = async (n: number) => {
    for (let i = 0; i < n; i++) {
      bot.emit('physicTick');
      await flush();
    }
  };

  test('records noPlanFailures when planner returns 0 paths', async () => {
    targetExecutor.setTargets([{ item: 'cooked_beef', count: 1 }]);
    await targetExecutor.startNextTarget();

    const request = await pumpUntilPlanningRequest(bot, workerManager, 'cooked_beef');
    expect(request).not.toBeNull();

    workerManager.resolve(request!.id, []);
    await flush();
    // Drive plan->failure->handleTargetFailure transitions.
    await pumpTicks(3);

    expect(targetExecutor.getNoPlanFailures()).toEqual([{ item: 'cooked_beef', count: 1 }]);
  });

  test('skips wander chain entirely on no-plan failure (shouldWander stays false)', async () => {
    // Use two targets so sequenceIndex stays observable at 1 after the
    // first target is fast-skipped (otherwise completeAllTargets would reset
    // it back to 0).
    targetExecutor.setTargets([
      { item: 'cooked_beef', count: 1 },
      { item: 'oak_log', count: 1 }
    ]);
    await targetExecutor.startNextTarget();

    const request = await pumpUntilPlanningRequest(bot, workerManager, 'cooked_beef');
    expect(request).not.toBeNull();

    workerManager.resolve(request!.id, []);
    await flush();
    await pumpTicks(3);

    // The plan->failure transition fires handleTargetFailure, which on the
    // no_plan branch must NOT set shouldWander.
    expect((targetExecutor as any).shouldWander).toBe(false);
    // Retry counter should not have been incremented either — we don't retry
    // on no_plan; we move on.
    expect((targetExecutor as any).targetRetryCount.size).toBe(0);
    // Sequence should have advanced past the unreachable target.
    expect((targetExecutor as any).sequenceIndex).toBe(1);
    expect(targetExecutor.getNoPlanFailures()).toEqual([{ item: 'cooked_beef', count: 1 }]);
  });

  test('continues sequence past no_plan target to next target', async () => {
    targetExecutor.setTargets([
      { item: 'cooked_beef', count: 1 },
      { item: 'oak_log', count: 1 }
    ]);
    await targetExecutor.startNextTarget();

    const beefReq = await pumpUntilPlanningRequest(bot, workerManager, 'cooked_beef');
    expect(beefReq).not.toBeNull();
    workerManager.resolve(beefReq!.id, []);
    await flush();
    await pumpTicks(3);

    // Bypass the SKIP_DELAY (1s) so the test doesn't depend on wall-clock time.
    (targetExecutor as any).delayUntil = 0;

    // Drive plan->failure->delay->idle->plan transitions for the next target.
    for (let i = 0; i < 20; i++) {
      bot.emit('physicTick');
      await flush();
      if (workerManager.findByItem('oak_log')) break;
    }

    const logReq = workerManager.findByItem('oak_log');
    expect(logReq).not.toBeNull();
    expect(targetExecutor.getNoPlanFailures()).toEqual([{ item: 'cooked_beef', count: 1 }]);
  });

  test('in-flight failure (plan returned, execution failed) still triggers wander+retry', async () => {
    const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');
    (buildStateMachineForPath as jest.Mock).mockImplementationOnce(
      (_b: any, _p: any[], onFinished: (s: boolean) => void) => ({
        update: jest.fn(),
        onStateEntered: jest.fn(() => onFinished(false)),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      })
    );

    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();

    const req = await pumpUntilPlanningRequest(bot, workerManager, 'oak_log');
    expect(req).not.toBeNull();
    // Resolve with a non-empty plan so we go down execute (not no_plan).
    workerManager.resolve(req!.id, [[{ action: 'mine', block: 'oak_log', count: 1 }]]);
    await flush();
    bot.emit('physicTick');
    await flush();
    bot.emit('physicTick');
    await flush();

    // After the in-flight failure, shouldWander should be true (existing
    // retry+wander path) and targetRetryCount should be incremented.
    expect((targetExecutor as any).shouldWander).toBe(true);
    expect(targetExecutor.getNoPlanFailures()).toEqual([]);
  });

  test('setTargets clears prior noPlanFailures', async () => {
    targetExecutor.setTargets([{ item: 'cooked_beef', count: 1 }]);
    await targetExecutor.startNextTarget();
    const req = await pumpUntilPlanningRequest(bot, workerManager, 'cooked_beef');
    workerManager.resolve(req!.id, []);
    await flush();
    await pumpTicks(3);
    expect(targetExecutor.getNoPlanFailures().length).toBe(1);

    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    expect(targetExecutor.getNoPlanFailures()).toEqual([]);
  });
});
