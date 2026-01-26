import { TargetExecutor } from '../../bots/collector/target_executor';
import { ReactiveBehaviorManager } from '../../bots/collector/reactive_behavior_manager';
import { createMockBot, createControlHarness, TestWorkerManager } from '../helpers/schedulerTestUtils';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

describe('Reactive Behavior Pre-emption', () => {
  const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');
  const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  let bot: any;
  let workerManager: TestWorkerManager;
  let targetExecutor: TargetExecutor;
  let reactiveManager: ReactiveBehaviorManager;
  let controlStack: any;
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
    bot.safeChat = safeChat;

    const harness = createControlHarness(bot, { config });
    workerManager = harness.workerManager;
    controlStack = harness.controlStack;
    targetExecutor = controlStack.targetLayer;
    reactiveManager = controlStack.reactiveLayer;
    controlStack.start();

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

    bot.emit('physicTick');
    bot.emit('physicTick');
    expect(targetTicks).toBeGreaterThanOrEqual(1);

    let reactiveTicks = 0;
    let finished = false;
    let allowReactive = false;

    const behavior = {
      priority: 100,
      name: 'hostile-mob',
      shouldActivate: async () => allowReactive,
      createState: async () => {
        const stateMachine: any = {
          update: () => {
            if (finished) return;
            reactiveTicks += 1;
            if (reactiveTicks >= 5) {
              finished = true;
              allowReactive = false;
            }
          },
          onStateEntered: jest.fn(),
          onStateExited: jest.fn(),
          transitions: [],
          states: [],
          isFinished: () => finished,
          wasSuccessful: () => true
        };
        return { stateMachine };
      }
    };

    reactiveManager.setEnabled(true);
    reactiveManager.registry.register(behavior as any);

    allowReactive = true;

    await flush();

    const targetTicksBefore = targetTicks;

    while (!finished) {
      bot.emit('physicTick');
      await flush();
    }

    expect(reactiveTicks).toBeGreaterThanOrEqual(5);
    expect(targetTicks).toBeLessThanOrEqual(targetTicksBefore + 1);

    bot.emit('physicTick');
    await flush();
    expect(targetTicks).toBeGreaterThan(targetTicksBefore);
  });
});
