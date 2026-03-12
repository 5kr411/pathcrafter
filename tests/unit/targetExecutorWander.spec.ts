import { TargetExecutor } from '../../bots/collector/target_executor';
import { createMockBot, createControlHarness } from '../helpers/schedulerTestUtils';

jest.mock('mineflayer-pathfinder', () => ({
  goals: {
    GoalXZ: class GoalXZ {
      x: number;
      z: number;
      constructor(x: number, z: number) {
        this.x = x;
        this.z = z;
      }
    },
    GoalNear: class GoalNear {
      x: number;
      y: number;
      z: number;
      range: number;
      constructor(x: number, y: number, z: number, range: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.range = range;
      }
    }
  }
}));

describe('TargetExecutor wander on retry', () => {
  let mockBot: any;
  let targetExecutor: TargetExecutor;
  let chatMessages: string[];

  beforeEach(() => {
    chatMessages = [];

    mockBot = createMockBot();
    mockBot.entity = { position: { x: 0, y: 64, z: 0 } };
    mockBot.pathfinder = {
      stop: jest.fn(),
      setGoal: jest.fn(),
      isMoving: jest.fn().mockReturnValue(false)
    };
    mockBot.clearControlStates = jest.fn();
    mockBot.inventory.items.mockReturnValue([]);

    const mockSafeChat = jest.fn((msg: string) => {
      chatMessages.push(msg);
    });
    mockBot.safeChat = mockSafeChat;

    const harness = createControlHarness(mockBot, {
      config: {
        snapshotRadii: [32],
        snapshotYHalf: null,
        pruneWithWorld: true,
        combineSimilarNodes: false,
        perGenerator: 1,
        toolDurabilityThreshold: 0.1
      }
    });
    targetExecutor = harness.controlStack.targetLayer;
  });

  afterEach(() => {
    targetExecutor['cleanupWander']();
    jest.clearAllMocks();
  });

  it('sets shouldWander to true on a retry failure', () => {
    const targets = [{ item: 'diamond', count: 5 }];
    targetExecutor.setTargets(targets);
    targetExecutor['running'] = true;
    targetExecutor['sequenceIndex'] = 0;
    targetExecutor['targetRetryCount'].set(0, 0);

    targetExecutor['handleTargetFailure']();

    expect(targetExecutor['shouldWander']).toBe(true);
    expect(targetExecutor['failureHandled']).toBe(true);
  });

  it('sets shouldWander to false when max retries exhausted (skip)', () => {
    const targets = [{ item: 'diamond', count: 5 }];
    targetExecutor.setTargets(targets);
    targetExecutor['running'] = true;
    targetExecutor['sequenceIndex'] = 0;
    targetExecutor['targetRetryCount'].set(0, 4);

    targetExecutor['handleTargetFailure']();

    expect(targetExecutor['shouldWander']).toBe(false);
    expect(targetExecutor['failureHandled']).toBe(true);
  });

  it('beginWander uses exponential distance based on retry count', () => {
    const targets = [{ item: 'diamond', count: 5 }];
    targetExecutor.setTargets(targets);
    targetExecutor['running'] = true;

    // retry 1 -> 16, retry 2 -> 32, retry 3 -> 64, retry 4 -> 128, retry 5 -> 256
    targetExecutor['targetRetryCount'].set(0, 1);
    targetExecutor['beginWander']();
    expect(targetExecutor['wanderBehavior']!.distance).toBe(16);
    targetExecutor['cleanupWander']();

    targetExecutor['targetRetryCount'].set(0, 3);
    targetExecutor['beginWander']();
    expect(targetExecutor['wanderBehavior']!.distance).toBe(64);
    targetExecutor['cleanupWander']();

    targetExecutor['targetRetryCount'].set(0, 5);
    targetExecutor['beginWander']();
    expect(targetExecutor['wanderBehavior']!.distance).toBe(256);
    targetExecutor['cleanupWander']();

    expect(targetExecutor['wanderDone']).toBe(false);
  });

  it('updateWander sets wanderDone and chats when behavior finishes', () => {
    const targets = [{ item: 'diamond', count: 5 }];
    targetExecutor.setTargets(targets);
    targetExecutor['running'] = true;

    targetExecutor['beginWander']();
    expect(targetExecutor['wanderDone']).toBe(false);

    targetExecutor['wanderBehavior']!.isFinished = true;
    targetExecutor['updateWander']();

    expect(targetExecutor['wanderDone']).toBe(true);
    expect(chatMessages).toContain('done wandering');
  });

  it('cleanupWander exits and clears the wander behavior', () => {
    const targets = [{ item: 'diamond', count: 5 }];
    targetExecutor.setTargets(targets);
    targetExecutor['running'] = true;

    targetExecutor['beginWander']();
    const wander = targetExecutor['wanderBehavior']!;
    const exitSpy = jest.spyOn(wander, 'onStateExited');

    targetExecutor['cleanupWander']();

    expect(exitSpy).toHaveBeenCalled();
    expect(targetExecutor['wanderBehavior']).toBeNull();
  });

  it('beginPlanning resets wander flags', () => {
    targetExecutor['shouldWander'] = true;
    targetExecutor['wanderDone'] = true;
    targetExecutor['running'] = false;

    targetExecutor['beginPlanning']();

    expect(targetExecutor['shouldWander']).toBe(false);
    expect(targetExecutor['wanderDone']).toBe(false);
  });
});
