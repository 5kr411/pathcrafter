import { ReactiveTestHarness } from '../helpers/reactiveTestHarness';

jest.mock('../../bots/collector/snapshot_manager', () => ({
  captureSnapshotForTarget: jest.fn()
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn(),
  _internals: {
    logActionPath: jest.fn()
  }
}));

const { captureSnapshotForTarget } = require('../../bots/collector/snapshot_manager');
const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine');

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForPlanningRequest(harness: ReactiveTestHarness, itemName: string, retries = 10): Promise<any> {
  for (let i = 0; i < retries; i += 1) {
    const record = harness.workerManager.findByItem(itemName);
    if (record) {
      return record;
    }
    // eslint-disable-next-line no-await-in-loop
    await harness.tick(1);
  }
  return null;
}

describe('integration: reactive runtime simulation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('suspends and resumes the base target around reactive execution', async () => {
    (captureSnapshotForTarget as jest.Mock).mockResolvedValue({ snapshot: { radius: 16 } });

    const baseTicks = { count: 0 };
    (buildStateMachineForPath as jest.Mock).mockImplementation(() => ({
      update: jest.fn(() => {
        baseTicks.count += 1;
      }),
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      transitions: [],
      states: []
    }));

    const harness = new ReactiveTestHarness();

    try {
      const targetExecutor = harness.controlStack.targetLayer;
      targetExecutor.setTargets([{ item: 'oak_log', count: 1 }]);
      await targetExecutor.startNextTarget();
      await flushMicrotasks();

      const request = await waitForPlanningRequest(harness, 'oak_log');
      expect(request).not.toBeNull();
      harness.workerManager.resolve(request!.id, [[{ action: 'mine', what: 'oak_log' }]]);

      await harness.tick(2);
      await harness.waitFor(() => baseTicks.count > 0, 1000);

      let allowReactive = false;
      let reactiveTicks = 0;
      let reactiveFinished = false;

      harness.registry.register({
        name: 'reactive-test',
        priority: 100,
        shouldActivate: () => allowReactive,
        createState: async () => {
          const stateMachine: any = {
            update: () => {
              if (reactiveFinished) return;
              reactiveTicks += 1;
              if (reactiveTicks >= 6) {
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
      });

      harness.enableReactivePolling();
      allowReactive = true;

      await harness.waitFor(() => harness.manager.isActive(), 1000);
      const ticksAtReactiveStart = baseTicks.count;

      await harness.waitFor(() => !harness.manager.isActive(), 2000);

      expect(reactiveTicks).toBeGreaterThanOrEqual(6);
      expect(baseTicks.count).toBe(ticksAtReactiveStart);

      await harness.waitFor(() => baseTicks.count > ticksAtReactiveStart, 1000);
    } finally {
      harness.disableReactivePolling();
    }
  });

  it('prevents overlapping reactive runs during continuous activation', async () => {
    const harness = new ReactiveTestHarness();

    try {
      let activeRuns = 0;
      let maxActive = 0;
      let runCount = 0;
      let reactiveTicks = 0;

      harness.registry.register({
        name: 'reactive-repeat',
        priority: 90,
        shouldActivate: () => true,
        createState: async () => {
          runCount += 1;
          activeRuns += 1;
          if (activeRuns > maxActive) maxActive = activeRuns;

          let finished = false;
          const stateMachine: any = {
            update: () => {
              reactiveTicks += 1;
            },
            onStateEntered: jest.fn(),
            onStateExited: jest.fn(),
            transitions: [],
            states: [],
            isFinished: () => finished,
            wasSuccessful: () => true
          };

          setTimeout(() => {
            finished = true;
            activeRuns -= 1;
          }, 250);

          return { stateMachine };
        }
      });

      harness.enableReactivePolling();

      await harness.advance(1200);
      harness.disableReactivePolling();
      await harness.waitFor(() => activeRuns === 0, 1000);

      expect(runCount).toBeGreaterThanOrEqual(2);
      expect(maxActive).toBe(1);
      expect(reactiveTicks).toBeGreaterThan(0);
    } finally {
      harness.disableReactivePolling();
    }
  });
});
