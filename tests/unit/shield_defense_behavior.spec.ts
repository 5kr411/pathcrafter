jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLevel: jest.fn()
}));

jest.mock('../../behaviors/behaviorFollowAndAttackEntity', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    isFinished: jest.fn(() => true),
    onStateExited: jest.fn()
  }))
}));

jest.mock('mineflayer-statemachine', () => {
  class StateTransition {
    parent: any;
    child: any;
    name?: string;
    shouldTransition?: () => boolean;
    onTransition?: () => void;

    constructor(config: any) {
      Object.assign(this, config);
    }

    trigger(): void {
      if (typeof this.onTransition === 'function') {
        this.onTransition();
      }
    }
  }

  class BehaviorIdle {}

  class NestedStateMachine {
    public stateName = '';
    public onStateExited: (..._args: any[]) => void = () => {};
    public isFinished: () => boolean = () => true;

    constructor(_transitions: any[], _enter: any, _exit?: any) {}
  }

  return {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
  };
});

const actualHostileMobModule = jest.requireActual('../../bots/collector/reactive_behaviors/hostile_mob_behavior');
jest.mock('../../bots/collector/reactive_behaviors/hostile_mob_behavior', () => ({
  __esModule: true,
  findClosestHostileMob: jest.fn(() => null),
  getHostileMobNames: jest.fn(() => new Set(['zombie', 'creeper'])),
  hasLineOfSight: jest.fn(() => true),
  isRangedHostile: actualHostileMobModule.isRangedHostile
}));

describe('unit: shield_defense_behavior', () => {
  const makePos = (x: number, y: number, z: number) => ({
    x,
    y,
    z,
    distanceTo(other: any) {
      const dx = (other.x ?? other.position?.x ?? 0) - x;
      const dy = (other.y ?? other.position?.y ?? 0) - y;
      const dz = (other.z ?? other.position?.z ?? 0) - z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  });

  let shieldDefenseBehavior: any;
  let hasShieldInOffhand: (bot: any) => boolean;
  let findClosestCreeper: (bot: any, radius: number) => any | null;
  let hostilesModule: any;

  beforeEach(() => {
    jest.resetModules();
    hostilesModule = require('../../bots/collector/reactive_behaviors/hostile_mob_behavior');
    hostilesModule.findClosestHostileMob.mockReset().mockReturnValue(null);
    const module = require('../../bots/collector/reactive_behaviors/shield_defense_behavior');
    shieldDefenseBehavior = module.shieldDefenseBehavior;
    hasShieldInOffhand = module.hasShieldInOffhand;
    findClosestCreeper = module.findClosestCreeper;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createShieldBot = (options?: { health?: number; maxHealth?: number; creeperDistance?: number | null }): any => {
    const { health = 20, maxHealth = 20, creeperDistance = null } = options ?? {};
    const slots = new Array(46).fill(null);
    slots[45] = { name: 'shield' };

    const bot: any = {
      health,
      maxHealth,
      entity: {
        position: makePos(0, 64, 0),
        health
      },
      inventory: { slots },
      getEquipmentDestSlot: jest.fn(() => 45),
      entities: {}
    };

    if (creeperDistance !== null) {
      bot.entities['creeper'] = {
        name: 'creeper',
        position: makePos(creeperDistance, 64, 0),
        health: 20
      };
    }

    return bot;
  };

  describe('hasShieldInOffhand', () => {
    test('returns true when shield present in off-hand slot', () => {
      const bot = createShieldBot();
      expect(hasShieldInOffhand(bot)).toBe(true);
    });

    test('returns false when off-hand slot empty', () => {
      const bot = createShieldBot();
      bot.inventory.slots[45] = null;
      expect(hasShieldInOffhand(bot)).toBe(false);
    });

    test('returns false when accessors unavailable', () => {
      const bot: any = {
        inventory: {},
        getEquipmentDestSlot: undefined
      };
      expect(hasShieldInOffhand(bot)).toBe(false);
    });
  });

  describe('findClosestCreeper', () => {
    test('returns nearest creeper within radius', () => {
      const bot = createShieldBot({ creeperDistance: 3 });
      const creeper = findClosestCreeper(bot, 5);
      expect(creeper).toBe(bot.entities['creeper']);
    });

    test('returns null when creeper outside radius', () => {
      const bot = createShieldBot({ creeperDistance: 10 });
      const creeper = findClosestCreeper(bot, 5);
      expect(creeper).toBeNull();
    });
  });

  describe('shouldActivate', () => {
    test('returns false when bot lacks shield', () => {
      const bot = createShieldBot();
      bot.inventory.slots[45] = null;
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns false when bot health depleted', () => {
      const bot = createShieldBot({ health: 0, maxHealth: 20 });
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns false when healthy and no creeper nearby', () => {
      const bot = createShieldBot({ health: 20, maxHealth: 20 });
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns true when below half health and melee hostile within 8 blocks', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20 });
      hostilesModule.findClosestHostileMob
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ name: 'zombie' });
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns false when below half health and melee hostile beyond 8 blocks', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20 });
      hostilesModule.findClosestHostileMob
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns true when below half health and skeleton variant within 16 blocks', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20 });
      hostilesModule.findClosestHostileMob
        .mockReturnValueOnce({ name: 'skeleton' });
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns true when below half health and stray within 16 blocks', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20 });
      hostilesModule.findClosestHostileMob
        .mockReturnValueOnce({ name: 'stray' });
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns true when creeper within range despite full health', () => {
      const bot = createShieldBot({ health: 20, maxHealth: 20, creeperDistance: 4 });
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(true);
    });

    test('passes isRangedHostile predicate for ranged hostile check', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20 });
      hostilesModule.findClosestHostileMob.mockReturnValue(null);
      shieldDefenseBehavior.shouldActivate(bot);

      const firstCall = hostilesModule.findClosestHostileMob.mock.calls[0];
      expect(firstCall[1]).toBe(16);
      expect(typeof firstCall[3]).toBe('function');
      const predicate = firstCall[3];

      expect(predicate({ name: 'skeleton' })).toBe(true);
      expect(predicate({ name: 'stray' })).toBe(true);
      expect(predicate({ name: 'bogged' })).toBe(true);
      expect(predicate({ name: 'parched' })).toBe(true);
      expect(predicate({ name: 'zombie' })).toBe(false);
      expect(predicate({ name: 'drowned' })).toBe(false);
      expect(predicate({ name: 'drowned', heldItem: { name: 'trident' } })).toBe(true);
      expect(predicate({ name: 'drowned', heldItem: { name: 'fishing_rod' } })).toBe(false);
      expect(predicate({ name: 'drowned', equipment: [{ name: 'trident' }] })).toBe(true);

      const secondCall = hostilesModule.findClosestHostileMob.mock.calls[1];
      expect(secondCall[1]).toBe(8);
      expect(secondCall[3]).toBeUndefined();
    });

    test('returns true when below half health and drowned with trident within 16 blocks', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20 });
      hostilesModule.findClosestHostileMob
        .mockReturnValueOnce({ name: 'drowned', heldItem: { name: 'trident' } });
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns false when below half health and drowned without trident beyond 8 blocks', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20 });
      hostilesModule.findClosestHostileMob
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(false);
    });
  });
});


