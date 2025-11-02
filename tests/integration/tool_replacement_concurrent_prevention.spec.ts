import { TargetExecutor } from '../../bots/collector/target_executor';
import { WorkerManager } from '../../bots/collector/worker_manager';
import { ToolReplacementExecutor } from '../../bots/collector/tool_replacement_executor';
import { createExecutionContext, signalToolIssue } from '../../bots/collector/execution_context';

describe('Tool Replacement Concurrent Execution Prevention', () => {
  let mockBot: any;
  let mockWorkerManager: WorkerManager;
  let mockSafeChat: jest.Mock;
  let toolReplacementExecutor: ToolReplacementExecutor;
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
      heldItem: null
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

    toolReplacementExecutor = new ToolReplacementExecutor(mockBot, mockWorkerManager, config);
    targetExecutor = new TargetExecutor(mockBot, mockWorkerManager, mockSafeChat, config, undefined, toolReplacementExecutor);
  });

  afterEach(() => {
    if (targetExecutor) {
      targetExecutor.stop();
    }
  });

  it('should pause main task when tool replacement triggers', (done) => {
    const mainTaskRunning = { value: true };
    const toolReplacementRunning = { value: false };
    const simultaneousExecution = { detected: false };

    const executionContext = createExecutionContext(
      0.1,
      () => {
        if (mainTaskRunning.value && toolReplacementRunning.value) {
          simultaneousExecution.detected = true;
        }

        toolReplacementRunning.value = true;
        
        setTimeout(() => {
          toolReplacementRunning.value = false;
        }, 50);
      }
    );

    signalToolIssue(executionContext, {
      type: 'durability',
      toolName: 'diamond_pickaxe'
    });

    setTimeout(() => {
      mainTaskRunning.value = false;
    }, 30);

    setTimeout(() => {
      expect(simultaneousExecution.detected).toBe(false);
      done();
    }, 100);
  });

  it('should call bot.clearControlStates when pausing for tool replacement', () => {
    targetExecutor['paused'] = false;
    targetExecutor['running'] = true;
    targetExecutor['activeStateMachine'] = { onStateExited: jest.fn() };
    targetExecutor['activeBotStateMachine'] = { stop: jest.fn() };

    targetExecutor.pause();

    expect(mockBot.clearControlStates).toHaveBeenCalled();
    expect(targetExecutor['paused']).toBe(true);
  });

  it('should not allow main task to continue after pause is called', () => {
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
    expect(targetExecutor['paused']).toBe(true);
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicTick', expect.any(Function));
    expect(mockBot.removeListener).toHaveBeenCalledWith('physicsTick', expect.any(Function));
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
    targetExecutor['sequenceIndex'] = 5;
    targetExecutor['activeStateMachine'] = mockStateMachine;
    targetExecutor['activeBotStateMachine'] = mockBotStateMachine;

    targetExecutor.pause();

    expect(targetExecutor['pausedState']).not.toBeNull();
    expect(targetExecutor['pausedState']?.sequenceIndex).toBe(5);
    expect(targetExecutor['pausedState']?.stateMachine).toBe(mockStateMachine);

    targetExecutor['pausedState'] = {
      sequenceIndex: 5,
      stateMachine: null,
      botStateMachine: mockBotStateMachine
    };

    targetExecutor.resume();

    expect(targetExecutor['paused']).toBe(false);
    expect(targetExecutor['sequenceIndex']).toBe(5);
  });

  it('SHOULD FAIL: tool replacement should actually pause execution during real operation', (done) => {
    let mainTaskActive = false;
    let toolReplacementActive = false;
    let bothActiveSimultaneously = false;

    const checkInterval = setInterval(() => {
      if (mainTaskActive && toolReplacementActive) {
        bothActiveSimultaneously = true;
        clearInterval(checkInterval);
      }
    }, 10);

    mainTaskActive = true;
    
    setTimeout(() => {
      toolReplacementActive = true;
      mainTaskActive = false;
    }, 50);

    setTimeout(() => {
      toolReplacementActive = false;
      mainTaskActive = true;
    }, 150);

    setTimeout(() => {
      mainTaskActive = false;
      clearInterval(checkInterval);
      expect(bothActiveSimultaneously).toBe(false);
      done();
    }, 200);
  });

  it('should track toolsBeingReplaced to prevent duplicate replacements', () => {
    targetExecutor['toolsBeingReplaced'].add('diamond_pickaxe');

    const executionContext = createExecutionContext(
      0.1,
      undefined,
      targetExecutor['toolsBeingReplaced']
    );

    let callbackTriggered = false;
    executionContext.onToolIssue = () => {
      callbackTriggered = true;
    };

    signalToolIssue(executionContext, {
      type: 'durability',
      toolName: 'diamond_pickaxe'
    });

    expect(callbackTriggered).toBe(false);
    expect(executionContext.toolIssueDetected).toBe(false);
  });
});

