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

jest.mock('../../behaviors/behaviorPvpAttack', () => {
  return {
    BehaviorPvpAttack: jest.fn().mockImplementation(() => ({
      stateName: 'BehaviorPvpAttack',
      active: false,
      isFinished: jest.fn(() => false),
      onStateEntered: jest.fn(),
      onStateExited: jest.fn(),
      forceStop: jest.fn()
    }))
  };
});

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

  const NestedStateMachine = jest.fn().mockImplementation(function(this: any, _transitions: any[], _enter: any, _exit?: any) {
    this.stateName = '';
    this.onStateExited = () => {};
    this.isFinished = () => true;
  });

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

  describe('createShieldDefenseState', () => {
    let createShieldDefenseState: any;

    beforeEach(() => {
      const mod = require('../../behaviors/behaviorShieldDefense');
      createShieldDefenseState = mod.createShieldDefenseState;
    });

    const makeShieldBot = () => {
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      const slots = new Array(46).fill(null);
      slots[45] = { name: 'shield', type: 442, durabilityUsed: 10, maxDurability: 336 };

      return {
        health: 20,
        entity: { position: makePos(0, 64, 0) },
        inventory: { slots },
        getEquipmentDestSlot: jest.fn(() => 45),
        activateItem: jest.fn(),
        deactivateItem: jest.fn(),
        clearControlStates: jest.fn(),
        lookAt: jest.fn(),
        on: jest.fn((event: string, fn: (...args: any[]) => void) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
        }),
        removeListener: jest.fn((event: string, fn: (...args: any[]) => void) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter(l => l !== fn);
          }
        }),
        emit: (event: string, ...args: any[]) => {
          (listeners[event] || []).forEach(fn => fn(...args));
        },
        pvp: { attack: jest.fn(), stop: jest.fn() }
      };
    };

    test('entitySwingArm from current threat triggers counter-attack', () => {
      jest.useFakeTimers();
      const bot = makeShieldBot();
      const threat = { id: 1, name: 'zombie', position: makePos(3, 64, 0), height: 1.8 };

      const targets: any = { entity: null };
      createShieldDefenseState(bot, {
        targets,
        reacquireThreat: () => threat,
        shouldContinue: () => true
      });

      // Access the internal shieldHold via the transitions passed to NestedStateMachine
      const { NestedStateMachine } = require('mineflayer-statemachine');
      const nsmCalls = (NestedStateMachine as jest.Mock).mock.calls;
      const lastCall = nsmCalls[nsmCalls.length - 1];
      const transitions = lastCall[0];

      // enterToShield is transitions[0], its child is shieldHold
      const enterToShield = transitions[0];
      const shieldHold = enterToShield.child;

      // Manually enter the shield hold state
      shieldHold.onStateEntered();

      // Verify listener was registered
      expect(bot.on).toHaveBeenCalledWith('entitySwingArm', expect.any(Function));

      // Emit entitySwingArm with the threat entity
      bot.emit('entitySwingArm', threat);

      // Should be finished with pendingThreat
      expect(shieldHold.isFinished()).toBe(true);
      expect(shieldHold.getNextThreat()).toBe(threat);

      // Cleanup
      shieldHold.onStateExited();
      jest.useRealTimers();
    });

    test('entitySwingArm from non-threat entity is ignored', () => {
      jest.useFakeTimers();
      const bot = makeShieldBot();
      const threat = { id: 1, name: 'zombie', position: makePos(3, 64, 0), height: 1.8 };
      const otherEntity = { id: 2, name: 'skeleton', position: makePos(5, 64, 0), height: 1.8 };

      const targets: any = { entity: null };
      createShieldDefenseState(bot, {
        targets,
        reacquireThreat: () => threat,
        shouldContinue: () => true
      });

      const { NestedStateMachine } = require('mineflayer-statemachine');
      const nsmCalls = (NestedStateMachine as jest.Mock).mock.calls;
      const lastCall = nsmCalls[nsmCalls.length - 1];
      const transitions = lastCall[0];
      const shieldHold = transitions[0].child;

      shieldHold.onStateEntered();

      // Emit swing from a different entity
      bot.emit('entitySwingArm', otherEntity);

      // Should NOT be finished — swing was from non-threat
      expect(shieldHold.isFinished()).toBe(false);

      shieldHold.onStateExited();
      jest.useRealTimers();
    });

    test('entitySwingArm listener is removed on cleanup', () => {
      jest.useFakeTimers();
      const bot = makeShieldBot();
      const threat = { id: 1, name: 'zombie', position: makePos(3, 64, 0), height: 1.8 };

      createShieldDefenseState(bot, {
        targets: { entity: null },
        reacquireThreat: () => threat,
        shouldContinue: () => true
      });

      const { NestedStateMachine } = require('mineflayer-statemachine');
      const nsmCalls = (NestedStateMachine as jest.Mock).mock.calls;
      const lastCall = nsmCalls[nsmCalls.length - 1];
      const shieldHold = lastCall[0][0].child;

      shieldHold.onStateEntered();
      expect(bot.on).toHaveBeenCalledWith('entitySwingArm', expect.any(Function));

      shieldHold.onStateExited();
      expect(bot.removeListener).toHaveBeenCalledWith('entitySwingArm', expect.any(Function));

      // Emitting after cleanup should have no effect
      bot.emit('entitySwingArm', threat);
      expect(shieldHold.isFinished()).toBe(false);

      jest.useRealTimers();
    });

    test('stale durability resets when shield item type changes', () => {
      jest.useFakeTimers();
      const bot = makeShieldBot();
      const threat = { id: 1, name: 'zombie', position: makePos(3, 64, 0), height: 1.8 };

      createShieldDefenseState(bot, {
        targets: { entity: null },
        reacquireThreat: () => threat,
        shouldContinue: () => true
      });

      const { NestedStateMachine } = require('mineflayer-statemachine');
      const nsmCalls = (NestedStateMachine as jest.Mock).mock.calls;
      const lastCall = nsmCalls[nsmCalls.length - 1];
      const shieldHold = lastCall[0][0].child;

      shieldHold.onStateEntered();

      // Replace the shield item with a different type (simulating recraft)
      bot.inventory.slots[45] = { name: 'shield', type: 999, durabilityUsed: 0, maxDurability: 336 };

      // Advance past a monitoring interval
      jest.advanceTimersByTime(50);

      // The shield hold should NOT have finished from damage detection
      // (the type change should have reset tracking, not triggered counter-attack)
      // It should still be active waiting for real damage
      // If it had not reset, it would compare old damage (10) with new (0) and
      // since 0 < 10, it resets. This is correct behavior.
      const logger = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith('ShieldDefense: shield item replaced, resetting durability tracking');

      shieldHold.onStateExited();
      jest.useRealTimers();
    });

    test('stale durability resets when damage goes down', () => {
      jest.useFakeTimers();
      const bot = makeShieldBot();
      const threat = { id: 1, name: 'zombie', position: makePos(3, 64, 0), height: 1.8 };

      createShieldDefenseState(bot, {
        targets: { entity: null },
        reacquireThreat: () => threat,
        shouldContinue: () => true
      });

      const { NestedStateMachine } = require('mineflayer-statemachine');
      const nsmCalls = (NestedStateMachine as jest.Mock).mock.calls;
      const lastCall = nsmCalls[nsmCalls.length - 1];
      const shieldHold = lastCall[0][0].child;

      shieldHold.onStateEntered();

      // Replace with same type but lower durability (recraft)
      bot.inventory.slots[45] = { name: 'shield', type: 442, durabilityUsed: 2, maxDurability: 336 };

      jest.advanceTimersByTime(50);

      const logger = require('../../utils/logger');
      expect(logger.info).toHaveBeenCalledWith('ShieldDefense: shield item replaced, resetting durability tracking');

      shieldHold.onStateExited();
      jest.useRealTimers();
    });

    test('max shield cycles prevents attackToShield and forces attackToExit', () => {
      jest.useFakeTimers();
      const bot = makeShieldBot();
      const threat = { id: 1, name: 'zombie', position: makePos(3, 64, 0), height: 1.8 };

      createShieldDefenseState(bot, {
        targets: { entity: null },
        reacquireThreat: () => threat,
        shouldContinue: () => true
      });

      const { NestedStateMachine } = require('mineflayer-statemachine');
      const nsmCalls = (NestedStateMachine as jest.Mock).mock.calls;
      const lastCall = nsmCalls[nsmCalls.length - 1];
      const transitions = lastCall[0];

      const findTransition = (suffix: string) => {
        const match = transitions.find((t: any) => typeof t.name === 'string' && t.name.endsWith(suffix));
        if (!match) throw new Error(`transition ending in "${suffix}" not found`);
        return match;
      };

      const enterToShield = findTransition('enter -> shield');
      const shieldToAttack = findTransition('shield -> attack');
      const attackToExit = findTransition('attack -> exit');
      const attackToShield = findTransition('attack -> shield');
      const shieldHold = enterToShield.child;
      const pvpAttack = shieldToAttack.child;

      // cycleCount increments in both shieldToAttack (+1) and attackToShield (+1)
      // So each full shield->attack->shield round adds 2 to cycleCount
      // MAX_SHIELD_CYCLES = 5, so after 3 shieldToAttack transitions (cycleCount=3)
      // and 2 attackToShield transitions (cycleCount=5), the next attackToShield is blocked.
      enterToShield.onTransition(); // resets cycleCount=0

      // Drive cycles until max is reached
      let cyclesCompleted = 0;
      while (true) {
        // Enter shield hold
        shieldHold.onStateEntered();
        bot.emit('entitySwingArm', threat);
        expect(shieldHold.isFinished()).toBe(true);

        // shieldToAttack increments cycleCount
        expect(shieldToAttack.shouldTransition()).toBe(true);
        shieldToAttack.onTransition();
        shieldHold.onStateExited();
        cyclesCompleted++;

        // Make pvpAttack finished
        pvpAttack.isFinished.mockReturnValue(true);

        // Check if attackToShield is blocked by max cycles
        if (!attackToShield.shouldTransition()) {
          break;
        }
        attackToShield.onTransition();
        pvpAttack.isFinished.mockReturnValue(false);
      }

      // The cycle cap should have been hit
      expect(cyclesCompleted).toBeGreaterThan(0);
      expect(cyclesCompleted).toBeLessThanOrEqual(5);

      // attackToExit should force exit due to max cycles
      expect(attackToExit.shouldTransition()).toBe(true);

      jest.useRealTimers();
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

    test('returns false when shield durability below 15% threshold', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20, creeperDistance: 4 });
      // Shield with 336 max durability, 300 used = 36 remaining = 10.7%
      bot.inventory.slots[45] = { name: 'shield', maxDurability: 336, durabilityUsed: 300 };
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns true when shield durability above 15% threshold', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20, creeperDistance: 4 });
      // Shield with 336 max durability, 200 used = 136 remaining = 40.5%
      bot.inventory.slots[45] = { name: 'shield', maxDurability: 336, durabilityUsed: 200 };
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns true when shield has no durability info (assumes usable)', () => {
      const bot = createShieldBot({ health: 8, maxHealth: 20, creeperDistance: 4 });
      // Shield without durability fields
      bot.inventory.slots[45] = { name: 'shield' };
      expect(shieldDefenseBehavior.shouldActivate(bot)).toBe(true);
    });
  });
});


