import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { ReactiveBehavior, Bot } from '../../bots/collector/reactive_behaviors/types';

jest.mock('mineflayer-statemachine', () => ({
  BotStateMachine: jest.fn((_bot: any, machine: any) => {
    machine.active = true;
    if (machine.enter) {
      machine.activeState = machine.enter;
    }
    return {
      stop: jest.fn(() => {
        machine.active = false;
      })
    };
  })
}));

describe('unit: ReactiveBehaviorExecutor', () => {
  let bot: Bot;
  let registry: ReactiveBehaviorRegistry;
  let executor: ReactiveBehaviorExecutorClass;

  beforeEach(() => {
    bot = {
      version: '1.20.1',
      entity: { position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 },
      entities: {}
    } as Bot;
    registry = new ReactiveBehaviorRegistry();
    executor = new ReactiveBehaviorExecutorClass(bot, registry);
  });

  describe('lifecycle', () => {
    test('starts inactive', () => {
      expect(executor.isActive()).toBe(false);
    });

    test('becomes active when executing behavior', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          expect(executor.isActive()).toBe(true);
          exec.finish(true);
          return null;
        }
      };

      const promise = executor.executeBehavior(behavior);
      await promise;
    });

    test('becomes inactive after finishing', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        }
      };

      await executor.executeBehavior(behavior);
      expect(executor.isActive()).toBe(false);
    });

    test('resolves with success status', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        }
      };

      const result = await executor.executeBehavior(behavior);
      expect(result).toBe(true);
    });

    test('resolves with failure status', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(false);
          return null;
        }
      };

      const result = await executor.executeBehavior(behavior);
      expect(result).toBe(false);
    });
  });

  describe('concurrent execution prevention', () => {
    test('rejects concurrent execution requests', async () => {
      const behavior1: ReactiveBehavior = {
        name: 'behavior_1',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          await new Promise(resolve => setTimeout(resolve, 50));
          exec.finish(true);
          return null;
        }
      };

      const behavior2: ReactiveBehavior = {
        name: 'behavior_2',
        priority: 50,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        }
      };

      const promise1 = executor.executeBehavior(behavior1);
      const promise2 = executor.executeBehavior(behavior2);

      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    test('allows execution after previous completes', async () => {
      const behavior1: ReactiveBehavior = {
        name: 'behavior_1',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        }
      };

      const behavior2: ReactiveBehavior = {
        name: 'behavior_2',
        priority: 50,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        }
      };

      const result1 = await executor.executeBehavior(behavior1);
      const result2 = await executor.executeBehavior(behavior2);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });
  });

  describe('state machine management', () => {
    test('creates state machine from behavior', async () => {
      const mockStateMachine = {
        enter: {},
        exit: {},
        transitions: [],
        onStateExited: null
      };

      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return mockStateMachine;
        }
      };

      await executor.executeBehavior(behavior);
    });

    test('handles behavior returning no state machine', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, _exec) => {
          return null;
        }
      };

      const result = await executor.executeBehavior(behavior);
      expect(result).toBe(false);
    });

    test('calls BotStateMachine constructor with state machine', async () => {
      const { BotStateMachine } = require('mineflayer-statemachine');
      jest.clearAllMocks();
      
      const mockStateMachine = {
        enter: {},
        exit: {},
        transitions: []
      };

      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          exec.finish(true);
          return mockStateMachine;
        }
      };

      await executor.executeBehavior(behavior);
      
      expect(BotStateMachine).toHaveBeenCalledWith(bot, mockStateMachine);
    });
  });

  describe('onDeactivate callback', () => {
    test('calls onDeactivate when behavior finishes', async () => {
      const onDeactivate = jest.fn();
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        },
        onDeactivate
      };

      await executor.executeBehavior(behavior);
      expect(onDeactivate).toHaveBeenCalled();
    });

    test('does not call onDeactivate if behavior has none', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        }
      };

      await executor.executeBehavior(behavior);
    });

    test('handles errors in onDeactivate gracefully', async () => {
      const onDeactivate = jest.fn(() => {
        throw new Error('Test error');
      });
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          exec.finish(true);
          return null;
        },
        onDeactivate
      };

      await executor.executeBehavior(behavior);
      expect(onDeactivate).toHaveBeenCalled();
    });
  });

  describe('stop method', () => {
    test('stops active execution', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          exec.finish(true);
          return null;
        }
      };

      const promise = executor.executeBehavior(behavior);
      executor.stop();

      const result = await promise;
      expect(result).toBe(false);
      expect(executor.isActive()).toBe(false);
    });

    test('does nothing when not active', () => {
      expect(() => executor.stop()).not.toThrow();
      expect(executor.isActive()).toBe(false);
    });
  });

  describe('error handling', () => {
    test('handles errors in execute gracefully', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, _exec) => {
          throw new Error('Test error');
        }
      };

      const result = await executor.executeBehavior(behavior);
      expect(result).toBe(false);
      expect(executor.isActive()).toBe(false);
    });

    test('handles errors when creating state machine', async () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async (_bot, exec) => {
          await new Promise(resolve => setTimeout(resolve, 1));
          exec.finish(false);
          return { invalid: 'state machine' };
        }
      };

      const result = await executor.executeBehavior(behavior);
      expect(result).toBe(false);
    });
  });
});

