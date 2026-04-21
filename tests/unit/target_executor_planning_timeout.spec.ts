import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

describe('TargetExecutor planning timeout + abort-on-stop', () => {
  const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  const pumpUntilPlanning = async (
    bot: any, executor: TargetExecutor, maxTicks = 5
  ): Promise<void> => {
    const map: Map<string, any> = (executor as any).inFlightPlanning;
    for (let i = 0; i < maxTicks; i++) {
      if (map.size > 0) return;
      bot.emit('physicTick');
      await flush();
    }
  };

  let bot: any;
  let targetExecutor: TargetExecutor;
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
    bot.safeChat = jest.fn();
    bot.inventory.items.mockReturnValue([]);
    bot.registry.items = {};

    const harness = createControlHarness(bot, { config });
    controlStack = harness.controlStack;
    targetExecutor = controlStack.targetLayer;
    controlStack.start();

    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 16 } });
  });

  afterEach(() => {
    try { targetExecutor.onStateExited(); } catch (_) {}
    jest.useRealTimers();
  });

  test('stop() aborts in-flight planning and clears the tracking map', async () => {
    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();
    await pumpUntilPlanning(bot, targetExecutor);

    const map: Map<string, any> = (targetExecutor as any).inFlightPlanning;
    expect(map.size).toBe(1);
    const [[, entry]] = Array.from(map.entries());
    expect(entry.controller.signal.aborted).toBe(false);

    const controller: AbortController = entry.controller;
    targetExecutor.stop();

    expect(map.size).toBe(0);
    expect(controller.signal.aborted).toBe(true);
  });

  test('timeout synthesizes a planning-failure result after PLANNING_TIMEOUT_MS', async () => {
    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();
    await pumpUntilPlanning(bot, targetExecutor);

    const map: Map<string, any> = (targetExecutor as any).inFlightPlanning;
    expect(map.size).toBe(1);
    const [[planningId, entry]] = Array.from(map.entries());
    const controller: AbortController = entry.controller;

    // Manually fire the timeout (simulates the 90s wall-clock expiring).
    const reason = new DOMException('planning timeout after 90000ms', 'TimeoutError');
    controller.abort(reason);
    await flush();

    expect(map.has(planningId as string)).toBe(false);
    expect((targetExecutor as any).planningOutcome).toBe('failure');
  });

  test('resetAndRestart() (death handler) aborts in-flight planning', async () => {
    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();
    await pumpUntilPlanning(bot, targetExecutor);

    const map: Map<string, any> = (targetExecutor as any).inFlightPlanning;
    expect(map.size).toBe(1);
    const [[, entry]] = Array.from(map.entries());
    const controller: AbortController = entry.controller;

    targetExecutor.resetAndRestart();

    expect(map.size).toBe(0);
    expect(controller.signal.aborted).toBe(true);
  });

  test('late worker callback after timeout synthesis is discarded', async () => {
    // This test catches a race: if the 90s timeout synthesizes a failure and
    // then the wedged worker eventually produces a result, that late callback
    // must not overwrite the executor's state. The guard is entry.id !==
    // this.planningId after the synthesized call clears planningId.
    const workerManager = (controlStack as any).workerManager;

    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();
    await pumpUntilPlanning(bot, targetExecutor);

    const map: Map<string, any> = (targetExecutor as any).inFlightPlanning;
    expect(map.size).toBe(1);
    const [[planningId, entry]] = Array.from(map.entries());
    const controller: AbortController = entry.controller;

    // Capture the worker callback registered by beginPlanning so we can fire
    // it manually AFTER the timeout synthesis.
    const record = workerManager.findByItem('oak_log');
    expect(record).not.toBeNull();

    // Fire the timeout, synthesizing a failure.
    controller.abort(new DOMException('planning timeout after 90000ms', 'TimeoutError'));
    await flush();

    expect((targetExecutor as any).planningOutcome).toBe('failure');
    expect((targetExecutor as any).planningId).toBeNull();

    // Now the late worker callback fires with an ok=true result. The executor
    // must discard it — not transition to execute, not overwrite the failure.
    workerManager.resolve(planningId as string, [[{ action: 'mine', block: 'oak_log', count: 1 }]]);
    await flush();

    expect((targetExecutor as any).planningOutcome).toBe('failure');
    expect((targetExecutor as any).planPath).toBeNull();
  });
});
