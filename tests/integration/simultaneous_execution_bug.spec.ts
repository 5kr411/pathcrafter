import { TargetExecutor } from '../../bots/collector/target_executor';
import { WorkerManager } from '../../bots/collector/worker_manager';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';

describe('SIMULTANEOUS EXECUTION BUG - Tool Replacement During Mining', () => {
  let mockBot: any;
  let mockWorkerManager: WorkerManager;
  let mockSafeChat: jest.Mock;
  let toolReplacementExecutor: ToolReplacementExecutor;
  let targetExecutor: TargetExecutor;
  let toolReplacementStateMachineActive: boolean;

  beforeEach(() => {
    toolReplacementStateMachineActive = false;

    mockBot = {
      entity: { position: { x: 0, y: 60, z: 0 } },
      inventory: {
        items: jest.fn().mockReturnValue([
          { name: 'diamond_pickaxe', type: 871, durabilityUsed: 1551, count: 1 }
        ])
      },
      registry: {
        blocks: { chest: { id: 54 } },
        items: {
          871: {
            name: 'diamond_pickaxe',
            maxDurability: 1561
          }
        }
      },
      clearControlStates: jest.fn(),
      removeAllListeners: jest.fn(),
      removeListener: jest.fn(),
      on: jest.fn(),
      heldItem: {
        name: 'diamond_pickaxe',
        type: 871,
        durabilityUsed: 1551
      }
    };

    mockSafeChat = jest.fn();

    mockWorkerManager = new WorkerManager(
      jest.fn(),
      jest.fn()
    );

    const config = {
      snapshotRadii: [32],
      snapshotYHalf: 16,
      pruneWithWorld: true,
      combineSimilarNodes: true,
      perGenerator: 5,
      toolDurabilityThreshold: 0.1
    };

    toolReplacementExecutor = new ToolReplacementExecutor(mockBot, mockWorkerManager, mockSafeChat, config);
    targetExecutor = new TargetExecutor(mockBot, mockWorkerManager, mockSafeChat, config, undefined, toolReplacementExecutor);
  });

  afterEach(() => {
    if (targetExecutor) {
      targetExecutor.stop();
    }
    if (toolReplacementExecutor) {
      toolReplacementExecutor.stop();
    }
  });

  it('MUST NOT allow main task state machine to continue after tool replacement triggers', (done) => {
    const mockMainTaskStateMachine = {
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      update: jest.fn(() => {
        if (mockMainTaskStateMachine.active && toolReplacementStateMachineActive) {
          clearInterval(updateInterval);
          done(new Error('BOTH STATE MACHINES ACTIVE: Main task state machine updated while tool replacement is active'));
        }
      }),
      transitions: [],
      states: [],
      active: true
    };

    const mockMainBotStateMachine = {
      isFinished: jest.fn().mockReturnValue(false),
      rootStateMachine: mockMainTaskStateMachine
    };

    const mockListener = jest.fn();
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['activeStateMachine'] = mockMainTaskStateMachine;
    targetExecutor['activeBotStateMachine'] = mockMainBotStateMachine;
    targetExecutor['activeBotStateMachineListener'] = mockListener;

    const updateInterval = setInterval(() => {
      if (mockMainTaskStateMachine.active) {
        try {
          mockMainTaskStateMachine.update();
        } catch (e) {}
      }
    }, 50);

    setTimeout(() => {
      targetExecutor.pause();

      expect(mockMainTaskStateMachine.active).toBe(false);
      expect(mockBot.clearControlStates).toHaveBeenCalled();
      expect(mockBot.removeListener).toHaveBeenCalled();

      toolReplacementStateMachineActive = true;

      setTimeout(() => {
        if (mockMainTaskStateMachine.active) {
          clearInterval(updateInterval);
          done(new Error('FAILURE: Main task state machine still active after pause'));
          return;
        }

        toolReplacementStateMachineActive = false;
        clearInterval(updateInterval);
        done();
      }, 200);
    }, 100);
  });

  it('MUST prevent activeBotStateMachine from processing after pause is called', (done) => {
    const mockMainTaskStateMachine = {
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      update: jest.fn(),
      transitions: [],
      states: [],
      active: true
    };

    const mockMainBotStateMachine = {
      isFinished: jest.fn().mockReturnValue(false),
      update: jest.fn(() => {
        if (mockMainTaskStateMachine.active) {
          mockMainTaskStateMachine.update();
        }
      }),
      rootStateMachine: mockMainTaskStateMachine
    };

    const mockListener = jest.fn();
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['activeStateMachine'] = mockMainTaskStateMachine;
    targetExecutor['activeBotStateMachine'] = mockMainBotStateMachine;
    targetExecutor['activeBotStateMachineListener'] = mockListener;

    const updateCallsBeforePause = mockMainTaskStateMachine.update.mock.calls.length;

    targetExecutor.pause();

    expect(mockMainTaskStateMachine.active).toBe(false);
    expect(targetExecutor['activeBotStateMachine']).toBeNull();
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicTick', expect.any(Function));
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicsTick', expect.any(Function));

    setTimeout(() => {
      const updatesAfterPause = mockMainTaskStateMachine.update.mock.calls.length - updateCallsBeforePause;
      if (updatesAfterPause > 0) {
        done(new Error(`State machine update() called ${updatesAfterPause} times after pause with active=false`));
      } else {
        done();
      }
    }, 100);
  });

  it('MUST verify activeBotStateMachine is nulled out after pause', (done) => {
    const mockStateMachine = {
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      transitions: [],
      states: [],
      active: true
    };

    const mockBotStateMachine = {
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      rootStateMachine: mockStateMachine
    };

    const mockListener = jest.fn();
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['activeStateMachine'] = mockStateMachine;
    targetExecutor['activeBotStateMachine'] = mockBotStateMachine;
    targetExecutor['activeBotStateMachineListener'] = mockListener;

    expect(targetExecutor['activeBotStateMachine']).not.toBeNull();
    expect(mockStateMachine.active).toBe(true);

    targetExecutor.pause();

    expect(mockStateMachine.active).toBe(false);
    expect(targetExecutor['activeBotStateMachine']).toBeNull();
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicTick', expect.any(Function));
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicsTick', expect.any(Function));

    done();
  });
});

