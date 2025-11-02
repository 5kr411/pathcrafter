import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { ReactiveBehavior, Bot } from '../../bots/collector/reactive_behaviors/types';

describe('unit: ReactiveBehaviorRegistry', () => {
  let registry: ReactiveBehaviorRegistry;

  beforeEach(() => {
    registry = new ReactiveBehaviorRegistry();
  });

  describe('registration', () => {
    test('registers a behavior', () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(behavior);
      const all = registry.getAll();

      expect(all).toHaveLength(1);
      expect(all[0]).toBe(behavior);
    });

    test('registers multiple behaviors', () => {
      const behavior1: ReactiveBehavior = {
        name: 'behavior_1',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };
      const behavior2: ReactiveBehavior = {
        name: 'behavior_2',
        priority: 30,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(behavior1);
      registry.register(behavior2);
      const all = registry.getAll();

      expect(all).toHaveLength(2);
    });

    test('unregisters a behavior by name', () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(behavior);
      expect(registry.getAll()).toHaveLength(1);

      registry.unregister('test_behavior');
      expect(registry.getAll()).toHaveLength(0);
    });

    test('unregister does nothing if behavior not found', () => {
      const behavior: ReactiveBehavior = {
        name: 'test_behavior',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(behavior);
      registry.unregister('nonexistent');
      
      expect(registry.getAll()).toHaveLength(1);
    });

    test('clear removes all behaviors', () => {
      const behavior1: ReactiveBehavior = {
        name: 'behavior_1',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };
      const behavior2: ReactiveBehavior = {
        name: 'behavior_2',
        priority: 30,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(behavior1);
      registry.register(behavior2);
      expect(registry.getAll()).toHaveLength(2);

      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe('priority ordering', () => {
    test('sorts behaviors by priority descending', () => {
      const lowPriority: ReactiveBehavior = {
        name: 'low',
        priority: 10,
        shouldActivate: () => false,
        execute: async () => null
      };
      const mediumPriority: ReactiveBehavior = {
        name: 'medium',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };
      const highPriority: ReactiveBehavior = {
        name: 'high',
        priority: 100,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(lowPriority);
      registry.register(mediumPriority);
      registry.register(highPriority);

      const all = registry.getAll();
      expect(all[0].priority).toBe(100);
      expect(all[1].priority).toBe(50);
      expect(all[2].priority).toBe(10);
    });

    test('maintains priority order when adding behaviors out of order', () => {
      const behavior1: ReactiveBehavior = {
        name: 'b1',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };
      const behavior2: ReactiveBehavior = {
        name: 'b2',
        priority: 100,
        shouldActivate: () => false,
        execute: async () => null
      };
      const behavior3: ReactiveBehavior = {
        name: 'b3',
        priority: 75,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(behavior1);
      registry.register(behavior2);
      registry.register(behavior3);

      const all = registry.getAll();
      expect(all[0].name).toBe('b2');
      expect(all[1].name).toBe('b3');
      expect(all[2].name).toBe('b1');
    });
  });

  describe('findActiveBehavior', () => {
    test('returns null when no behaviors are registered', async () => {
      const bot = { entity: { position: { x: 0, y: 0, z: 0 } } } as Bot;
      const result = await registry.findActiveBehavior(bot);
      expect(result).toBeNull();
    });

    test('returns null when no behaviors should activate', async () => {
      const behavior1: ReactiveBehavior = {
        name: 'b1',
        priority: 100,
        shouldActivate: () => false,
        execute: async () => null
      };
      const behavior2: ReactiveBehavior = {
        name: 'b2',
        priority: 50,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(behavior1);
      registry.register(behavior2);

      const bot = { entity: { position: { x: 0, y: 0, z: 0 } } } as Bot;
      const result = await registry.findActiveBehavior(bot);
      expect(result).toBeNull();
    });

    test('returns the behavior that should activate', async () => {
      const behavior: ReactiveBehavior = {
        name: 'active_behavior',
        priority: 100,
        shouldActivate: () => true,
        execute: async () => null
      };

      registry.register(behavior);

      const bot = { entity: { position: { x: 0, y: 0, z: 0 } } } as Bot;
      const result = await registry.findActiveBehavior(bot);
      expect(result).toBe(behavior);
    });

    test('returns highest priority behavior when multiple should activate', async () => {
      const lowPriority: ReactiveBehavior = {
        name: 'low',
        priority: 50,
        shouldActivate: () => true,
        execute: async () => null
      };
      const highPriority: ReactiveBehavior = {
        name: 'high',
        priority: 100,
        shouldActivate: () => true,
        execute: async () => null
      };

      registry.register(lowPriority);
      registry.register(highPriority);

      const bot = { entity: { position: { x: 0, y: 0, z: 0 } } } as Bot;
      const result = await registry.findActiveBehavior(bot);
      expect(result).toBe(highPriority);
      expect(result?.name).toBe('high');
    });

    test('skips behaviors that should not activate and returns first active one', async () => {
      const inactive1: ReactiveBehavior = {
        name: 'inactive_high',
        priority: 100,
        shouldActivate: () => false,
        execute: async () => null
      };
      const active: ReactiveBehavior = {
        name: 'active_medium',
        priority: 50,
        shouldActivate: () => true,
        execute: async () => null
      };
      const inactive2: ReactiveBehavior = {
        name: 'inactive_low',
        priority: 10,
        shouldActivate: () => false,
        execute: async () => null
      };

      registry.register(inactive1);
      registry.register(active);
      registry.register(inactive2);

      const bot = { entity: { position: { x: 0, y: 0, z: 0 } } } as Bot;
      const result = await registry.findActiveBehavior(bot);
      expect(result).toBe(active);
      expect(result?.name).toBe('active_medium');
    });

    test('handles async shouldActivate functions', async () => {
      const behavior: ReactiveBehavior = {
        name: 'async_behavior',
        priority: 100,
        shouldActivate: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return true;
        },
        execute: async () => null
      };

      registry.register(behavior);

      const bot = { entity: { position: { x: 0, y: 0, z: 0 } } } as Bot;
      const result = await registry.findActiveBehavior(bot);
      expect(result).toBe(behavior);
    });

    test('handles errors in shouldActivate gracefully', async () => {
      const errorBehavior: ReactiveBehavior = {
        name: 'error_behavior',
        priority: 100,
        shouldActivate: () => {
          throw new Error('Test error');
        },
        execute: async () => null
      };
      const goodBehavior: ReactiveBehavior = {
        name: 'good_behavior',
        priority: 50,
        shouldActivate: () => true,
        execute: async () => null
      };

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      registry.register(errorBehavior);
      registry.register(goodBehavior);

      const bot = { entity: { position: { x: 0, y: 0, z: 0 } } } as Bot;
      const result = await registry.findActiveBehavior(bot);
      
      expect(result).toBe(goodBehavior);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});

