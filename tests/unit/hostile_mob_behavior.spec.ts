import { getCachedMcData } from '../testHelpers';

jest.mock('../../behaviors/behaviorHuntEntity', () => ({
  __esModule: true,
  default: jest.fn(),
  getFailedTargetCooldownRemaining: jest.fn(() => 0)
}));

describe('unit: hostile_mob_behavior', () => {
  let hostileMobBehavior: any;
  let getHostileMobNames: any;
  let createHuntEntityState: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    const module = require('../../bots/collector/reactive_behaviors/hostile_mob_behavior');
    hostileMobBehavior = module.hostileMobBehavior;
    createHuntEntityState = require('../../behaviors/behaviorHuntEntity').default as jest.Mock;
    createHuntEntityState.mockReset();
    
    getHostileMobNames = (mcData: any) => {
      const hostileMobs = new Set<string>();
      
      if (!mcData) return hostileMobs;

      let entities: any[] = [];
      if (mcData.entities) {
        if (Array.isArray(mcData.entities)) {
          entities = mcData.entities;
        } else if (typeof mcData.entities === 'object') {
          entities = Object.values(mcData.entities);
        }
      }

      if (mcData.entitiesArray) {
        entities = mcData.entitiesArray;
      }

      for (const entity of entities) {
        if (!entity || !entity.name) continue;

        if (entity.type === 'hostile' || entity.category === 'hostile') {
          hostileMobs.add(entity.name);
          continue;
        }

        const name = entity.name.toLowerCase();
        const isHostile = 
          name.includes('zombie') || name.includes('skeleton') || 
          name.includes('creeper') || name.includes('spider') || 
          name.includes('enderman') || name.includes('witch') || 
          name.includes('blaze') || name.includes('ghast') || 
          name.includes('magma_cube') || name.includes('slime') ||
          name.includes('piglin') || name.includes('hoglin') || 
          name.includes('zoglin') || name.includes('pillager') ||
          name.includes('vindicator') || name.includes('evoker') || 
          name.includes('ravager') || name.includes('vex') || 
          name.includes('phantom') || name.includes('drowned') || 
          name.includes('husk') || name.includes('stray') || 
          name.includes('wither') || name.includes('endermite') ||
          name.includes('silverfish') || name.includes('guardian') || 
          name.includes('shulker') || name.includes('ender_dragon');

        if (isHostile) {
          hostileMobs.add(entity.name);
        }
      }

      return hostileMobs;
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getHostileMobNames', () => {
    test('returns empty set when mcData is null', () => {
      const result = getHostileMobNames(null);
      expect(result.size).toBe(0);
    });

    test('returns empty set when mcData has no entities', () => {
      const result = getHostileMobNames({});
      expect(result.size).toBe(0);
    });

    test('uses entity type field if available', () => {
      const mcData = {
        entities: [
          { name: 'test_hostile', type: 'hostile' },
          { name: 'test_passive', type: 'passive' }
        ]
      };
      const result = getHostileMobNames(mcData);
      expect(result.has('test_hostile')).toBe(true);
      expect(result.has('test_passive')).toBe(false);
    });

    test('uses entity category field if available', () => {
      const mcData = {
        entities: [
          { name: 'test_hostile', category: 'hostile' },
          { name: 'test_passive', category: 'passive' }
        ]
      };
      const result = getHostileMobNames(mcData);
      expect(result.has('test_hostile')).toBe(true);
      expect(result.has('test_passive')).toBe(false);
    });

    test('falls back to name matching for zombie', () => {
      const mcData = {
        entities: [
          { name: 'zombie' },
          { name: 'zombie_villager' },
          { name: 'chicken' }
        ]
      };
      const result = getHostileMobNames(mcData);
      expect(result.has('zombie')).toBe(true);
      expect(result.has('zombie_villager')).toBe(true);
      expect(result.has('chicken')).toBe(false);
    });

    test('detects common hostile mobs by name', () => {
      const mcData = {
        entities: [
          { name: 'zombie' },
          { name: 'skeleton' },
          { name: 'creeper' },
          { name: 'spider' },
          { name: 'enderman' },
          { name: 'witch' },
          { name: 'pig' }
        ]
      };
      const result = getHostileMobNames(mcData);
      expect(result.has('zombie')).toBe(true);
      expect(result.has('skeleton')).toBe(true);
      expect(result.has('creeper')).toBe(true);
      expect(result.has('spider')).toBe(true);
      expect(result.has('enderman')).toBe(true);
      expect(result.has('witch')).toBe(true);
      expect(result.has('pig')).toBe(false);
    });

    test('works with real minecraft-data', () => {
      const mcData = getCachedMcData('1.20.1');
      const result = getHostileMobNames(mcData);
      expect(result.size).toBeGreaterThan(0);
    });
  });

  describe('shouldActivate', () => {
    test('returns false when no hostile mobs nearby', () => {
      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: (_pos: any) => 10 } },
        entities: {
          '1': { name: 'pig', position: { x: 5, y: 64, z: 0 } },
          '2': { name: 'cow', position: { x: -5, y: 64, z: 0 } }
        }
      };
      const result = hostileMobBehavior.shouldActivate(bot);
      expect(result).toBe(false);
    });

    test('returns true when hostile mob within 16 blocks', () => {
      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 10 } },
        entities: {
          '1': { name: 'zombie', position: { x: 10, y: 64, z: 0 }, health: 20 }
        }
      };
      const result = hostileMobBehavior.shouldActivate(bot);
      expect(result).toBe(true);
    });

    test('returns false when hostile mob beyond 16 blocks', () => {
      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 20 } },
        entities: {
          '1': { name: 'zombie', position: { x: 20, y: 64, z: 0 }, health: 20 }
        }
      };
      const result = hostileMobBehavior.shouldActivate(bot);
      expect(result).toBe(false);
    });

    test('returns false when hostile mob is dead', () => {
      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 5 } },
        entities: {
          '1': { name: 'zombie', position: { x: 5, y: 64, z: 0 }, health: 0 }
        }
      };
      const result = hostileMobBehavior.shouldActivate(bot);
      expect(result).toBe(false);
    });

    test('returns false when hostile mob isAlive returns false', () => {
      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 5 } },
        entities: {
          '1': { 
            name: 'zombie', 
            position: { x: 5, y: 64, z: 0 }, 
            isAlive: () => false 
          }
        }
      };
      const result = hostileMobBehavior.shouldActivate(bot);
      expect(result).toBe(false);
    });

    test('returns false when hostile mob is obstructed by solid block', () => {
      const blockAt = jest.fn((pos: any) => {
        if (Math.floor(pos.x) === 0 && Math.floor(pos.y) === 65 && Math.floor(pos.z) === 2) {
          return { name: 'stone', boundingBox: 'block', transparent: false };
        }
        return null;
      });

      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 5, height: 1.62 } },
        entities: {
          '1': {
            name: 'zombie',
            position: { x: 0, y: 64, z: 4 },
            health: 20
          }
        },
        blockAt,
        chat: jest.fn(),
        safeChat: jest.fn()
      };

      const result = hostileMobBehavior.shouldActivate(bot);
      expect(result).toBe(false);
      expect(blockAt).toHaveBeenCalled();
    });
  });

  describe('createState', () => {
    test('returns null when no hostile mob found', async () => {
      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 10 } },
        entities: {
          '1': { name: 'pig', position: { x: 5, y: 64, z: 0 } }
        },
        safeChat: jest.fn(),
        chat: jest.fn()
      };

      const result = await hostileMobBehavior.createState(bot);
      
      expect(result).toBeNull();
    });

    test('announces combat start and completion via safeChat', async () => {
      jest.useFakeTimers();

      const machine = {
        update: jest.fn(),
        onStateEntered: jest.fn(),
        onStateExited: jest.fn(),
        isFinished: jest.fn().mockReturnValue(true)
      };
      createHuntEntityState.mockReturnValue(machine);

      const bot = {
        version: '1.20.1',
        entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 5 } },
        entities: {
          '1': {
            name: 'zombie',
            displayName: 'Zombie',
            position: { x: 5, y: 64, z: 0 },
            health: 20
          }
        },
        safeChat: jest.fn(),
        chat: jest.fn()
      };

      const result = await hostileMobBehavior.createState(bot);

      expect(result?.stateMachine).toBe(machine);
      expect(bot.safeChat).toHaveBeenCalledWith('fighting Zombie');

      jest.runOnlyPendingTimers();

      result?.onStop?.('completed');
      expect(bot.safeChat).toHaveBeenCalledWith('done fighting Zombie');

      jest.useRealTimers();
    });
  });

  describe('behavior properties', () => {
    test('has correct name', () => {
      expect(hostileMobBehavior.name).toBe('hostile_mob_combat');
    });

    test('has priority 100', () => {
      expect(hostileMobBehavior.priority).toBe(100);
    });

    test('has createState function', () => {
      expect(typeof hostileMobBehavior.createState).toBe('function');
    });
  });
});
