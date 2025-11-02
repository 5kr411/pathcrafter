import { TargetExecutor } from '../../bots/collector/target_executor';
import { WorkerManager } from '../../bots/collector/worker_manager';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { ReactiveBehavior } from '../../bots/collector/reactive_behaviors/types';

describe('Reactive Behavior Concurrent Execution Prevention', () => {
  let mockBot: any;
  let mockWorkerManager: WorkerManager;
  let mockSafeChat: jest.Mock;
  let reactiveBehaviorRegistry: ReactiveBehaviorRegistry;
  let reactiveBehaviorExecutor: ReactiveBehaviorExecutorClass;
  let targetExecutor: TargetExecutor;

  beforeEach(() => {
    mockBot = {
      entity: { position: { x: 0, y: 60, z: 0 } },
      inventory: {
        items: jest.fn().mockReturnValue([])
      },
      registry: {
        blocks: { chest: { id: 54 } },
        items: {}
      },
    clearControlStates: jest.fn(),
    removeAllListeners: jest.fn(),
    removeListener: jest.fn(),
    on: jest.fn(),
      heldItem: null,
      nearestEntity: jest.fn().mockReturnValue(null)
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

    reactiveBehaviorRegistry = new ReactiveBehaviorRegistry();
    reactiveBehaviorExecutor = new ReactiveBehaviorExecutorClass(mockBot, reactiveBehaviorRegistry);
    targetExecutor = new TargetExecutor(mockBot, mockWorkerManager, mockSafeChat, config, reactiveBehaviorExecutor);
  });

  afterEach(() => {
    if (targetExecutor) {
      targetExecutor.stop();
    }
  });

  it('should pause main task when reactive behavior triggers', (done) => {
    const mainTaskRunning = { value: true };
    const reactiveBehaviorRunning = { value: false };
    const simultaneousExecution = { detected: false };

    const mockBehavior: ReactiveBehavior = {
      priority: 100,
      name: 'test-behavior',
      shouldActivate: async () => true,
      execute: async (_bot, executor) => {
        if (mainTaskRunning.value) {
          simultaneousExecution.detected = true;
        }
        
        reactiveBehaviorRunning.value = true;
        
        setTimeout(() => {
          reactiveBehaviorRunning.value = false;
          executor.finish(true);
        }, 50);

        return {
          isFinished: () => false,
          onStateExited: () => {}
        };
      }
    };

    reactiveBehaviorRegistry.register(mockBehavior);

    setTimeout(() => {
      mainTaskRunning.value = false;
    }, 30);

    setTimeout(() => {
      expect(simultaneousExecution.detected).toBe(false);
      done();
    }, 100);
  });

  it('should call bot.clearControlStates when pausing for reactive behavior', () => {
    targetExecutor['paused'] = false;
    targetExecutor['running'] = true;
    targetExecutor['activeStateMachine'] = { onStateExited: jest.fn() };
    targetExecutor['activeBotStateMachine'] = { stop: jest.fn() };

    targetExecutor.pause();

    expect(mockBot.clearControlStates).toHaveBeenCalled();
    expect(targetExecutor['paused']).toBe(true);
  });

  it('should stop activeBotStateMachine when pausing', () => {
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    const mockStateMachine = { 
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      active: true
    };
    const mockListener = jest.fn();
    targetExecutor['activeStateMachine'] = mockStateMachine;
    targetExecutor['activeBotStateMachine'] = { 
      isFinished: jest.fn().mockReturnValue(false),
      rootStateMachine: mockStateMachine
    };
    targetExecutor['activeBotStateMachineListener'] = mockListener;

    targetExecutor.pause();

    expect(mockStateMachine.active).toBe(false);
    expect(targetExecutor['activeBotStateMachine']).toBeNull();
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicTick', expect.any(Function));
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicsTick', expect.any(Function));
  });

  it('should not call onStateExited on activeStateMachine during pause', () => {
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    const mockOnStateExited = jest.fn();
    targetExecutor['activeStateMachine'] = { 
      onStateExited: mockOnStateExited,
      isFinished: jest.fn().mockReturnValue(false)
    };
    targetExecutor['activeBotStateMachine'] = { 
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false)
    };

    targetExecutor.pause();

    expect(mockOnStateExited).not.toHaveBeenCalled();
  });

  it('should preserve main task state during pause', () => {
    const mockStateMachine = { 
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      states: []
    };
    const mockBotStateMachine = { 
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false)
    };

    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['sequenceIndex'] = 3;
    targetExecutor['activeStateMachine'] = mockStateMachine;
    targetExecutor['activeBotStateMachine'] = mockBotStateMachine;

    targetExecutor.pause();

    expect(targetExecutor['pausedState']).not.toBeNull();
    expect(targetExecutor['pausedState']?.sequenceIndex).toBe(3);
    expect(targetExecutor['pausedState']?.stateMachine).toBe(mockStateMachine);
    expect(targetExecutor['pausedState']?.botStateMachine).toBe(mockBotStateMachine);
  });

  it('should restore state correctly after resume', () => {
    const mockStateMachine = { 
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      states: []
    };
    const mockBotStateMachine = { 
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false)
    };

    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['sequenceIndex'] = 7;
    targetExecutor['activeStateMachine'] = mockStateMachine;
    targetExecutor['activeBotStateMachine'] = mockBotStateMachine;

    targetExecutor.pause();
    
    targetExecutor['pausedState'] = {
      sequenceIndex: 7,
      stateMachine: null,
      botStateMachine: mockBotStateMachine
    };
    
    targetExecutor.resume();

    expect(targetExecutor['paused']).toBe(false);
    expect(targetExecutor['sequenceIndex']).toBe(7);
  });

  it('should clear pausedState after resume', () => {
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['activeStateMachine'] = { 
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      states: []
    };
    targetExecutor['activeBotStateMachine'] = { 
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false)
    };

    targetExecutor.pause();
    
    expect(targetExecutor['pausedState']).not.toBeNull();
    
    const mockBotStateMachine = { 
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false)
    };
    targetExecutor['pausedState'] = {
      sequenceIndex: 0,
      stateMachine: null,
      botStateMachine: mockBotStateMachine
    };
    
    targetExecutor.resume();
    
    expect(targetExecutor['pausedState']).toBeNull();
  });

  it('SHOULD FAIL: reactive behavior execution should truly stop main task', (done) => {
    let mainTaskDigging = false;
    let reactiveBehaviorAttacking = false;
    let bothActiveSimultaneously = false;

    const checkInterval = setInterval(() => {
      if (mainTaskDigging && reactiveBehaviorAttacking) {
        bothActiveSimultaneously = true;
        clearInterval(checkInterval);
      }
    }, 10);

    mainTaskDigging = true;
    
    setTimeout(() => {
      reactiveBehaviorAttacking = true;
      mainTaskDigging = false;
    }, 50);

    setTimeout(() => {
      reactiveBehaviorAttacking = false;
      mainTaskDigging = true;
    }, 150);

    setTimeout(() => {
      mainTaskDigging = false;
      clearInterval(checkInterval);
      expect(bothActiveSimultaneously).toBe(false);
      done();
    }, 200);
  });

  it('should prevent reactive behavior check during pause', () => {
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['reactiveBehaviorCheckInterval'] = setInterval(() => {}, 500) as any;

    targetExecutor.pause();

    expect(targetExecutor['reactiveBehaviorCheckInterval']).toBeNull();
  });

  it('should restart reactive behavior check after resume', () => {
    targetExecutor['running'] = true;
    targetExecutor['paused'] = false;
    targetExecutor['activeStateMachine'] = { 
      onStateExited: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false),
      states: []
    };
    targetExecutor['activeBotStateMachine'] = { 
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false)
    };

    targetExecutor.pause();
    expect(targetExecutor['reactiveBehaviorCheckInterval']).toBeNull();

    const mockBotStateMachine = { 
      stop: jest.fn(),
      isFinished: jest.fn().mockReturnValue(false)
    };
    targetExecutor['pausedState'] = {
      sequenceIndex: 0,
      stateMachine: null,
      botStateMachine: mockBotStateMachine
    };

    targetExecutor.resume();
    expect(targetExecutor['reactiveBehaviorCheckInterval']).not.toBeNull();

    if (targetExecutor['reactiveBehaviorCheckInterval']) {
      clearInterval(targetExecutor['reactiveBehaviorCheckInterval']);
    }
  });
});

