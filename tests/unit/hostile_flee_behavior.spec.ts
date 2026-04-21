jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLevel: jest.fn()
}));

jest.mock('../../utils/movement', () => ({
  forceStopAllMovement: jest.fn()
}));

const mockGoalXZ = jest.fn();
jest.mock('mineflayer-pathfinder', () => ({
  goals: { GoalXZ: mockGoalXZ }
}));

const mockFindClosestCreeper: jest.Mock = jest.fn().mockReturnValue(null);
const mockFindShieldItem: jest.Mock = jest.fn().mockReturnValue(null);
const mockIsShieldUsable: jest.Mock = jest.fn().mockReturnValue(true);
jest.mock('../../bots/collector/reactive_behaviors/shield_defense_behavior', () => ({
  findClosestCreeper: (...args: any) => mockFindClosestCreeper(...args),
  findShieldItem: (...args: any) => mockFindShieldItem(...args),
  isShieldUsable: (...args: any) => mockIsShieldUsable(...args)
}));

const mockFindClosestHostileMobRaw: jest.Mock = jest.fn().mockReturnValue(null);
const mockFindClosestHostileMob = jest.fn((...args: any) => {
  const result = mockFindClosestHostileMobRaw(...args);
  const predicate = args[3];
  if (result && typeof predicate === 'function' && !predicate(result)) {
    return null;
  }
  return result;
});
const mockIsRangedHostile: jest.Mock = jest.fn((entity: any) => {
  const name = String(entity?.name || '').toLowerCase();
  return ['skeleton', 'stray', 'bogged', 'parched'].includes(name);
});
jest.mock('../../bots/collector/reactive_behaviors/hostile_mob_behavior', () => ({
  findClosestHostileMob: (...args: any) => mockFindClosestHostileMob(...args),
  hasLineOfSight: jest.fn(() => true),
  isRangedHostile: (...args: any) => mockIsRangedHostile(...args)
}));

import { hostileFleeBehavior, FLEE_MEMORY_MS } from '../../bots/collector/reactive_behaviors/hostile_flee_behavior';
import { forceStopAllMovement } from '../../utils/movement';

function createState(bot: any): any {
  return hostileFleeBehavior.createState(bot);
}

/**
 * Drive the outer NSM the way the reactive executor does. Per
 * mineflayer-statemachine/lib/statemachine.js semantics:
 *  - onStateEntered() sets activeState = enter and calls its
 *    onStateEntered, but does NOT check transitions.
 *  - Each update() call runs activeState.update() first, then scans
 *    transitions and fires AT MOST ONE. A chain of transitions
 *    (CaptureThreat -> FleeVisible -> Exit) takes one update() per
 *    hop. Each transition fires the child's onStateEntered, which is
 *    where side effects like setGoal happen.
 *
 * The helpers below make the tick-count explicit.
 */
function enterAndTick(sm: any): void {
  sm.onStateEntered();
  sm.update();
}

function tickUntilFinished(sm: any, maxTicks = 10): boolean {
  for (let i = 0; i < maxTicks; i++) {
    sm.update();
    if (sm.isFinished()) return true;
  }
  return sm.isFinished();
}

function makeBot(overrides: any = {}) {
  return {
    version: '1.20.1',
    entity: {
      position: {
        x: 0, y: 64, z: 0,
        distanceTo: (other: any) => {
          const dx = 0 - other.x;
          const dy = 64 - other.y;
          const dz = 0 - other.z;
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      },
      yaw: 0,
      pitch: 0
    },
    entities: {},
    health: 8,
    maxHealth: 20,
    chat: jest.fn(),
    safeChat: jest.fn(),
    pathfinder: { setGoal: jest.fn() },
    on: jest.fn(),
    off: jest.fn(),
    removeListener: jest.fn(),
    ...overrides
  };
}

function makeCreeper(x: number, z: number) {
  return {
    name: 'creeper',
    displayName: 'Creeper',
    position: { x, y: 64, z },
    health: 20
  };
}

function makeZombie(x: number, z: number) {
  return {
    name: 'zombie',
    displayName: 'Zombie',
    position: { x, y: 64, z },
    health: 20
  };
}

describe('unit: hostile_flee_behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFindClosestCreeper.mockReturnValue(null);
    mockFindShieldItem.mockReturnValue(null);
    mockIsShieldUsable.mockReturnValue(true);
    mockFindClosestHostileMobRaw.mockReturnValue(null);
    mockGoalXZ.mockImplementation((x: number, z: number) => ({ x, z }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('behavior properties', () => {
    test('has correct name', () => {
      expect(hostileFleeBehavior.name).toBe('hostile_flee');
    });

    test('has priority 110', () => {
      expect(hostileFleeBehavior.priority).toBe(110);
    });

    test('FLEE_MEMORY_MS is exported and positive', () => {
      expect(FLEE_MEMORY_MS).toBeGreaterThan(0);
    });
  });

  describe('shouldActivate', () => {
    test('returns false when bot has a usable shield', () => {
      mockFindShieldItem.mockReturnValue({ name: 'shield', maxDurability: 336, durabilityUsed: 0 });
      mockIsShieldUsable.mockReturnValue(true);
      const bot = makeBot();
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns true when creeper is nearby', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns true when low health and hostile mob nearby', () => {
      const zombie = makeZombie(5, 0);
      mockFindClosestHostileMobRaw.mockReturnValue(zombie);
      const bot = makeBot({ health: 10, maxHealth: 20 });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns false when health at or above 60% threshold', () => {
      const zombie = makeZombie(5, 0);
      mockFindClosestHostileMobRaw.mockReturnValue(zombie);
      const bot = makeBot({ health: 13, maxHealth: 20 });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns false when no threats at all', () => {
      const bot = makeBot();
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(false);
    });
  });

  describe('createState', () => {
    test('returns null when no pathfinder', () => {
      const bot = makeBot({ pathfinder: null });
      const result = createState(bot);
      expect(result).toBeNull();
    });

    test('returns state with stateMachine and preserved stateName', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);
      expect(result).not.toBeNull();
      expect(result.stateMachine).toBeDefined();
      expect(result.stateMachine.stateName).toBe('HostileFlee');
    });

    test('finishes immediately when no threat found on entry', () => {
      const bot = makeBot();
      const result = createState(bot);
      expect(result).not.toBeNull();

      enterAndTick(result.stateMachine);
      expect(result.stateMachine.isFinished()).toBe(true);
    });

    test('announces fleeing via safeChat on entry', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      expect(bot.safeChat).toHaveBeenCalledWith('fleeing Creeper');
    });

    test('sets pathfinder goal after first tick transitions to FleeVisible', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      expect(bot.pathfinder.setGoal).toHaveBeenCalled();
    });
  });

  describe('update with visible threat', () => {
    test('continues fleeing when threat is visible and close', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      expect(result.stateMachine.isFinished()).toBe(false);

      jest.advanceTimersByTime(800);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);
    });

    test('finishes when safe distance reached', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);

      creeper.position.x = 35;
      jest.advanceTimersByTime(800);
      expect(tickUntilFinished(result.stateMachine)).toBe(true);
    });

    test('finishes when shield acquired mid-flee', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);

      mockFindShieldItem.mockReturnValue({ name: 'shield', maxDurability: 336, durabilityUsed: 0 });
      mockIsShieldUsable.mockReturnValue(true);
      expect(tickUntilFinished(result.stateMachine)).toBe(true);
    });
  });

  describe('flee memory after LOS lost', () => {
    test('continues fleeing after threat disappears within memory window', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      expect(result.stateMachine.isFinished()).toBe(false);

      mockFindClosestCreeper.mockReturnValue(null);

      jest.advanceTimersByTime(1000);
      result.stateMachine.update(); // FleeVisible signals lostThreat
      result.stateMachine.update(); // transition to FleeFromMemory
      expect(result.stateMachine.isFinished()).toBe(false);
    });

    test('continues fleeing up until memory expires', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);

      mockFindClosestCreeper.mockReturnValue(null);

      jest.advanceTimersByTime(FLEE_MEMORY_MS - 100);
      result.stateMachine.update();
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);
    });

    test('finishes fleeing after memory window expires', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot({ health: 8, maxHealth: 20 });
      const result = createState(bot);

      enterAndTick(result.stateMachine);

      mockFindClosestCreeper.mockReturnValue(null);

      jest.advanceTimersByTime(FLEE_MEMORY_MS + 100);
      expect(tickUntilFinished(result.stateMachine)).toBe(true);
    });

    test('resets memory timer when threat reappears', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);

      // Disappear — still within memory window
      mockFindClosestCreeper.mockReturnValue(null);
      jest.advanceTimersByTime(FLEE_MEMORY_MS - 500);
      result.stateMachine.update();
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);

      // Reappear — back to FleeVisible, which refreshes lastThreatSeenTime
      mockFindClosestCreeper.mockReturnValue(creeper);
      jest.advanceTimersByTime(100);
      result.stateMachine.update(); // FleeFromMemory signals threatReappeared
      result.stateMachine.update(); // transition to FleeVisible
      expect(result.stateMachine.isFinished()).toBe(false);

      // Disappear again — memory timer resets here because FleeVisible
      // just recorded a fresh lastThreatSeenTime
      mockFindClosestCreeper.mockReturnValue(null);
      jest.advanceTimersByTime(FLEE_MEMORY_MS - 500);
      result.stateMachine.update();
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);

      // Now past the new memory window
      jest.advanceTimersByTime(600);
      expect(tickUntilFinished(result.stateMachine)).toBe(true);
    });

    test('updates goal from last known position during memory window', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);

      const botPos = {
        x: 0, y: 64, z: 0,
        distanceTo: (other: any) => {
          const dx = botPos.x - other.x;
          const dy = botPos.y - other.y;
          const dz = botPos.z - other.z;
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      };
      const bot = makeBot({ entity: { position: botPos, yaw: 0, pitch: 0 } });
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      const callsAfterEnter = bot.pathfinder.setGoal.mock.calls.length;

      mockFindClosestCreeper.mockReturnValue(null);
      botPos.x = -5;
      botPos.z = 3;

      jest.advanceTimersByTime(1000);
      result.stateMachine.update(); // FleeVisible signals lostThreat
      result.stateMachine.update(); // transition; FleeFromMemory.onStateEntered refreshes goal

      expect(bot.pathfinder.setGoal.mock.calls.length).toBeGreaterThan(callsAfterEnter);
    });

    test('finishes during memory window if safe distance reached from last known pos', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);

      const botPos = {
        x: 0, y: 64, z: 0,
        distanceTo: (other: any) => {
          const dx = botPos.x - other.x;
          const dy = botPos.y - other.y;
          const dz = botPos.z - other.z;
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      };
      const bot = makeBot({ entity: { position: botPos, yaw: 0, pitch: 0 } });
      const result = createState(bot);

      enterAndTick(result.stateMachine);

      mockFindClosestCreeper.mockReturnValue(null);
      botPos.x = 40;

      jest.advanceTimersByTime(1000);
      expect(tickUntilFinished(result.stateMachine)).toBe(true);
    });
  });

  describe('skeleton-specific flee with armor check', () => {
    test('returns true when ranged hostile nearby and armor < 10, even at full health', () => {
      const skeleton = { name: 'skeleton', displayName: 'Skeleton', position: { x: 5, y: 64, z: 0 }, health: 20 };
      mockFindClosestHostileMobRaw.mockReturnValue(skeleton);
      const bot = makeBot({ health: 20, maxHealth: 20 });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns false when ranged hostile nearby and armor >= 10 and full health', () => {
      const skeleton = { name: 'skeleton', displayName: 'Skeleton', position: { x: 5, y: 64, z: 0 }, health: 20 };
      mockFindClosestHostileMobRaw.mockReturnValue(skeleton);
      const bot = makeBot({
        health: 20,
        maxHealth: 20,
        entity: {
          position: {
            x: 0, y: 64, z: 0,
            distanceTo: (other: any) => {
              const dx = 0 - other.x;
              const dy = 64 - other.y;
              const dz = 0 - other.z;
              return Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
          },
          yaw: 0,
          pitch: 0,
          attributes: { 'generic.armor': { value: 12 } }
        }
      });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(false);
    });

    test('returns true when ranged hostile nearby and armor >= 10 but low health', () => {
      const skeleton = { name: 'skeleton', displayName: 'Skeleton', position: { x: 5, y: 64, z: 0 }, health: 20 };
      mockFindClosestHostileMobRaw.mockReturnValue(skeleton);
      const bot = makeBot({
        health: 8,
        maxHealth: 20,
        entity: {
          position: {
            x: 0, y: 64, z: 0,
            distanceTo: (other: any) => {
              const dx = 0 - other.x;
              const dy = 64 - other.y;
              const dz = 0 - other.z;
              return Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
          },
          yaw: 0,
          pitch: 0,
          attributes: { 'generic.armor': { value: 12 } }
        }
      });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(true);
    });
  });

  describe('shield durability bypass', () => {
    test('returns true (flees) when shield durability below 15% and threat present', () => {
      mockFindShieldItem.mockReturnValue({ name: 'shield', maxDurability: 336, durabilityUsed: 300 });
      mockIsShieldUsable.mockReturnValue(false);
      mockFindClosestHostileMobRaw.mockReturnValue({ name: 'zombie', position: { x: 5, y: 64, z: 0 }, health: 20 });
      const bot = makeBot({ health: 8, maxHealth: 20 });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns false when shield durability above 15%', () => {
      mockFindShieldItem.mockReturnValue({ name: 'shield', maxDurability: 336, durabilityUsed: 100 });
      mockIsShieldUsable.mockReturnValue(true);
      const bot = makeBot({ health: 8, maxHealth: 20 });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(false);
    });
  });

  describe('onStop cleanup', () => {
    test('forceStopAllMovement is called on any onStop reason', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      result.onStop('aborted');
      expect(forceStopAllMovement).toHaveBeenCalledWith(bot, 'hostile flee exit');
    });
  });

  describe('onStop chat', () => {
    test('announces done fleeing on completed', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      result.onStop('completed');
      expect(bot.safeChat).toHaveBeenCalledWith('done fleeing Creeper');
    });

    test('announces pausing flee on preempted', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      result.onStop('preempted');
      expect(bot.safeChat).toHaveBeenCalledWith('pausing flee Creeper');
    });

    test('announces stopped fleeing on aborted', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      enterAndTick(result.stateMachine);
      result.onStop('aborted');
      expect(bot.safeChat).toHaveBeenCalledWith('stopped fleeing Creeper');
    });
  });
});
