import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

describe('Conditional plan resume after preemption', () => {
  const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');
  const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

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

  it('resumes state machine when inventory deps are satisfied', async () => {
    // Mine step with no tool required — deps always satisfied
    const buildMock = buildStateMachineForPath as jest.Mock;
    buildMock.mockImplementationOnce(
      (_bot: any, _path: any[], _onFinished: (s: boolean) => void, _ctx: any, _onStep?: (i: number) => void) => ({
        update: jest.fn(),
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      })
    );

    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();

    // Pump ticks until planning request appears
    let request = null;
    for (let i = 0; i < 5; i++) {
      bot.emit('physicTick');
      await flush();
      request = workerManager.findByItem('oak_log');
      if (request) break;
    }
    expect(request).not.toBeNull();

    // Resolve planning with a simple mine step (no tool)
    workerManager.resolve(request!.id, [[{ action: 'mine', block: 'oak_log', count: 1 }]]);

    // Pump ticks until execution begins (activeStateMachine gets set)
    for (let i = 0; i < 5; i++) {
      bot.emit('physicTick');
      await flush();
    }

    // Verify execution started
    expect(buildMock).toHaveBeenCalled();

    // Simulate preemption: call onStateExited
    targetExecutor.onStateExited();

    // Plan should be preserved — activeStateMachine not cleared
    // Access private fields via cast
    const executor = targetExecutor as any;
    expect(executor.activeStateMachine).not.toBeNull();
    expect(executor.flowStarted).toBe(true);
    expect(executor.planningOutcome).not.toBe('idle');
  });

  it('invalidates plan when a required tool is missing from inventory', async () => {
    // Start with stone_pickaxe in inventory
    bot.inventory.items.mockReturnValue([
      { name: 'stone_pickaxe', type: 274, count: 1 }
    ]);

    const buildMock = buildStateMachineForPath as jest.Mock;
    buildMock.mockImplementationOnce(
      (_bot: any, _path: any[], _onFinished: (s: boolean) => void, _ctx: any, _onStep?: (i: number) => void) => ({
        update: jest.fn(),
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      })
    );

    targetExecutor.setTargets([{ item: 'cobblestone', count: 3 }]);
    await targetExecutor.startNextTarget();

    let request = null;
    for (let i = 0; i < 5; i++) {
      bot.emit('physicTick');
      await flush();
      request = workerManager.findByItem('cobblestone');
      if (request) break;
    }
    expect(request).not.toBeNull();

    // Resolve with a mine step requiring stone_pickaxe
    workerManager.resolve(request!.id, [[{
      action: 'mine',
      block: 'stone',
      count: 3,
      tool: {
        mode: 'one_of',
        variants: [{ value: 'stone_pickaxe' }]
      }
    }]]);

    for (let i = 0; i < 5; i++) {
      bot.emit('physicTick');
      await flush();
    }

    expect(buildMock).toHaveBeenCalled();

    // Remove stone_pickaxe from inventory (simulating it broke)
    bot.inventory.items.mockReturnValue([]);

    // Simulate preemption
    targetExecutor.onStateExited();

    const executor = targetExecutor as any;
    expect(executor.activeStateMachine).toBeNull();
    expect(executor.flowStarted).toBe(false);
    expect(executor.planningOutcome).toBe('idle');
  });

  it('invalidates when no activeStateMachine exists', async () => {
    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();

    // Pump a couple ticks so planning starts, but do NOT resolve the planning request
    for (let i = 0; i < 3; i++) {
      bot.emit('physicTick');
      await flush();
    }

    // Still in planning state — no activeStateMachine
    const executor = targetExecutor as any;
    expect(executor.activeStateMachine).toBeNull();

    // Simulate preemption
    targetExecutor.onStateExited();

    expect(executor.flowStarted).toBe(false);
    expect(executor.planningOutcome).toBe('idle');
  });

  it('invalidates when executionDone is true', async () => {
    const buildMock = buildStateMachineForPath as jest.Mock;
    buildMock.mockImplementationOnce(
      (_bot: any, _path: any[], onFinished: (s: boolean) => void, _ctx: any, _onStep?: (i: number) => void) => ({
        update: () => {
          // Immediately finish execution
          onFinished(true);
        },
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        transitions: [],
        states: []
      })
    );

    targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
    await targetExecutor.startNextTarget();

    let request = null;
    for (let i = 0; i < 5; i++) {
      bot.emit('physicTick');
      await flush();
      request = workerManager.findByItem('oak_log');
      if (request) break;
    }
    expect(request).not.toBeNull();

    workerManager.resolve(request!.id, [[{ action: 'mine', block: 'oak_log', count: 1 }]]);

    // Pump ticks — execution will start and immediately call onFinished(true)
    for (let i = 0; i < 5; i++) {
      bot.emit('physicTick');
      await flush();
    }

    const executor = targetExecutor as any;
    expect(executor.executionDone).toBe(true);

    // Simulate preemption
    targetExecutor.onStateExited();

    expect(executor.activeStateMachine).toBeNull();
  });
});
