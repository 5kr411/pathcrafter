import { TargetExecutor } from '../../bots/collector/target_executor';
import { WorkerManager } from '../../bots/collector/worker_manager';

describe('Target Completion Cleanup', () => {
  let mockBot: any;
  let mockWorkerManager: WorkerManager;
  let mockSafeChat: jest.Mock;
  let targetExecutor: TargetExecutor;

  beforeEach(() => {
    mockBot = {
      entity: { position: { x: 0, y: 60, z: 0 } },
      inventory: {
        items: jest.fn().mockReturnValue([
          { name: 'diamond', type: 870, count: 1 }
        ])
      },
      clearControlStates: jest.fn(),
      removeListener: jest.fn(),
      on: jest.fn()
    };

    mockWorkerManager = {
      postPlanningRequest: jest.fn(),
      clearPending: jest.fn(),
      stop: jest.fn()
    } as any;

    mockSafeChat = jest.fn();

    const mockReactiveBehaviorExecutor = {
      isActive: jest.fn().mockReturnValue(false),
      executeBehavior: jest.fn(),
      stop: jest.fn(),
      registry: {
        findActiveBehavior: jest.fn().mockResolvedValue(null)
      }
    };

    targetExecutor = new TargetExecutor(mockBot, mockWorkerManager, mockSafeChat, {
      snapshotRadii: [32],
      snapshotYHalf: null,
      pruneWithWorld: true,
      combineSimilarNodes: false,
      perGenerator: 1,
      toolDurabilityThreshold: 0.1
    }, mockReactiveBehaviorExecutor as any);
  });

  afterEach(() => {
    // Manually stop any intervals
    if (targetExecutor) {
      targetExecutor['stopReactiveBehaviorCheck']();
    }
    jest.clearAllMocks();
  });

  it('MUST stop reactive behavior check interval when all targets complete', async () => {
    // Start with targets
    const targets = [{ item: 'diamond', count: 1 }];
    targetExecutor.setTargets(targets);

    // Start the reactive behavior check while "running"
    targetExecutor['running'] = true;
    targetExecutor['startReactiveBehaviorCheck']();

    const intervalBefore = targetExecutor['reactiveBehaviorCheckInterval'];
    expect(intervalBefore).not.toBeNull();

    // Simulate reaching the end of targets
    targetExecutor['sequenceIndex'] = 1; // Past the last target
    targetExecutor['sequenceTargets'] = targets;
    targetExecutor['running'] = false; // Set to false so startNextTarget can execute

    // Call startNextTarget which should detect completion
    await targetExecutor['startNextTarget']();

    // Interval should be cleared
    const intervalAfter = targetExecutor['reactiveBehaviorCheckInterval'];
    expect(intervalAfter).toBeNull();
  });

  it('MUST clear bot control states when all targets complete', () => {
    const targets = [{ item: 'diamond', count: 1 }];

    targetExecutor['running'] = false; // Must be false to allow startNextTarget to execute
    targetExecutor['sequenceTargets'] = targets;
    targetExecutor['sequenceIndex'] = 1; // Past the last target

    mockBot.clearControlStates.mockClear();

    // Call startNextTarget synchronously (it will handle completion immediately)
    targetExecutor['startNextTarget']();

    expect(mockBot.clearControlStates).toHaveBeenCalled();
    expect(targetExecutor['running']).toBe(false);
  });

  it('MUST not restart reactive behavior check after completion', () => {
    const targets = [{ item: 'diamond', count: 1 }];

    // Start with running=true to start the interval
    targetExecutor['running'] = true;
    targetExecutor['sequenceTargets'] = targets;
    targetExecutor['sequenceIndex'] = 1; // Past the last target
    
    // Start the interval so we can verify it gets stopped
    targetExecutor['startReactiveBehaviorCheck']();
    expect(targetExecutor['reactiveBehaviorCheckInterval']).not.toBeNull();

    // Now set running=false so startNextTarget can execute
    targetExecutor['running'] = false;
    targetExecutor['startNextTarget']();

    // Interval should be cleared
    expect(targetExecutor['reactiveBehaviorCheckInterval']).toBeNull();
    // Targets should be cleared
    expect(targetExecutor['sequenceTargets'].length).toBe(0);
  });
});

