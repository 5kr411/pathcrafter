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
jest.mock('../../bots/collector/reactive_behaviors/shield_defense_behavior', () => ({
  findClosestCreeper: (...args: any) => mockFindClosestCreeper(...args),
  findShieldItem: (...args: any) => mockFindShieldItem(...args)
}));

const mockFindClosestHostileMob: jest.Mock = jest.fn().mockReturnValue(null);
jest.mock('../../bots/collector/reactive_behaviors/hostile_mob_behavior', () => ({
  findClosestHostileMob: (...args: any) => mockFindClosestHostileMob(...args),
  hasLineOfSight: jest.fn(() => true)
}));

import { hostileFleeBehavior, FLEE_MEMORY_MS } from '../../bots/collector/reactive_behaviors/hostile_flee_behavior';
import { forceStopAllMovement } from '../../utils/movement';

function createState(bot: any): any {
  return hostileFleeBehavior.createState(bot);
}

function makeBot(overrides: any = {}) {
  return {
    version: '1.20.1',
    entity: {
      position: { x: 0, y: 64, z: 0, distanceTo: (other: any) => {
        const dx = 0 - other.x;
        const dy = 64 - other.y;
        const dz = 0 - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }},
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
    mockFindClosestHostileMob.mockReturnValue(null);
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
    test('returns false when bot has a shield', () => {
      mockFindShieldItem.mockReturnValue({ name: 'shield' });
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
      mockFindClosestHostileMob.mockReturnValue(zombie);
      const bot = makeBot({ health: 8, maxHealth: 20 });
      expect(hostileFleeBehavior.shouldActivate(bot)).toBe(true);
    });

    test('returns false when healthy and no creeper', () => {
      const zombie = makeZombie(5, 0);
      mockFindClosestHostileMob.mockReturnValue(zombie);
      const bot = makeBot({ health: 20, maxHealth: 20 });
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

    test('returns state with stateMachine when pathfinder exists', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);
      expect(result).not.toBeNull();
      expect(result.stateMachine).toBeDefined();
      expect(result.stateMachine.stateName).toBe('HostileFlee');
    });

    test('finishes immediately on enter when no threat found', () => {
      const bot = makeBot();
      const result = createState(bot);
      expect(result).not.toBeNull();

      result.stateMachine.onStateEntered();
      expect(result.stateMachine.isFinished()).toBe(true);
    });

    test('announces fleeing via safeChat on enter', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      expect(bot.safeChat).toHaveBeenCalledWith('fleeing Creeper');
    });

    test('sets pathfinder goal on enter', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      expect(bot.pathfinder.setGoal).toHaveBeenCalled();
    });
  });

  describe('update with visible threat', () => {
    test('continues fleeing when threat is visible and close', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
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

      result.stateMachine.onStateEntered();

      creeper.position.x = 30;
      jest.advanceTimersByTime(800);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(true);
    });

    test('finishes when shield acquired mid-flee', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();

      mockFindShieldItem.mockReturnValue({ name: 'shield' });
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(true);
    });
  });

  describe('flee memory after LOS lost', () => {
    test('continues fleeing after threat disappears within memory window', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      expect(result.stateMachine.isFinished()).toBe(false);

      mockFindClosestCreeper.mockReturnValue(null);

      jest.advanceTimersByTime(1000);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);
    });

    test('continues fleeing up until memory expires', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();

      mockFindClosestCreeper.mockReturnValue(null);

      jest.advanceTimersByTime(FLEE_MEMORY_MS - 100);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);
    });

    test('finishes fleeing after memory window expires', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot({ health: 8, maxHealth: 20 });
      const result = createState(bot);

      result.stateMachine.onStateEntered();

      mockFindClosestCreeper.mockReturnValue(null);

      jest.advanceTimersByTime(FLEE_MEMORY_MS + 100);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(true);
    });

    test('resets memory timer when threat reappears', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();

      mockFindClosestCreeper.mockReturnValue(null);
      jest.advanceTimersByTime(FLEE_MEMORY_MS - 500);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);

      mockFindClosestCreeper.mockReturnValue(creeper);
      jest.advanceTimersByTime(100);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);

      mockFindClosestCreeper.mockReturnValue(null);
      jest.advanceTimersByTime(FLEE_MEMORY_MS - 500);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(false);

      jest.advanceTimersByTime(600);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(true);
    });

    test('updates goal from last known position during memory window', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);

      const botPos = { x: 0, y: 64, z: 0, distanceTo: (other: any) => {
        const dx = botPos.x - other.x;
        const dy = botPos.y - other.y;
        const dz = botPos.z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }};
      const bot = makeBot({ entity: { position: botPos, yaw: 0, pitch: 0 } });
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      const callsAfterEnter = bot.pathfinder.setGoal.mock.calls.length;

      mockFindClosestCreeper.mockReturnValue(null);
      botPos.x = -5;
      botPos.z = 3;

      jest.advanceTimersByTime(1000);
      result.stateMachine.update();

      expect(bot.pathfinder.setGoal.mock.calls.length).toBeGreaterThan(callsAfterEnter);
    });

    test('finishes during memory window if safe distance reached from last known pos', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);

      const botPos = { x: 0, y: 64, z: 0, distanceTo: (other: any) => {
        const dx = botPos.x - other.x;
        const dy = botPos.y - other.y;
        const dz = botPos.z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }};
      const bot = makeBot({ entity: { position: botPos, yaw: 0, pitch: 0 } });
      const result = createState(bot);

      result.stateMachine.onStateEntered();

      mockFindClosestCreeper.mockReturnValue(null);
      botPos.x = 30;

      jest.advanceTimersByTime(1000);
      result.stateMachine.update();
      expect(result.stateMachine.isFinished()).toBe(true);
    });
  });

  describe('onStateExited', () => {
    test('stops movement on exit', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      result.stateMachine.onStateExited();
      expect(forceStopAllMovement).toHaveBeenCalledWith(bot, 'hostile flee exit');
    });
  });

  describe('onStop', () => {
    test('announces done fleeing on completed', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      result.onStop('completed');
      expect(bot.safeChat).toHaveBeenCalledWith('done fleeing Creeper');
    });

    test('announces pausing flee on preempted', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      result.onStop('preempted');
      expect(bot.safeChat).toHaveBeenCalledWith('pausing flee Creeper');
    });

    test('announces stopped fleeing on aborted', () => {
      const creeper = makeCreeper(5, 0);
      mockFindClosestCreeper.mockReturnValue(creeper);
      const bot = makeBot();
      const result = createState(bot);

      result.stateMachine.onStateEntered();
      result.onStop('aborted');
      expect(bot.safeChat).toHaveBeenCalledWith('stopped fleeing Creeper');
    });
  });
});
