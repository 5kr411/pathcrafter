jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLevel: jest.fn()
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

import {
  BehaviorCaptureThreat,
  BehaviorFleeVisible,
  BehaviorFleeFromMemory,
  FleeContext,
  FLEE_MEMORY_MS
} from '../../bots/collector/reactive_behaviors/hostile_flee_states';

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

function makeCtx(overrides: Partial<FleeContext> = {}): FleeContext {
  return {
    threatLabel: 'hostile mob',
    lastKnownThreatPos: null,
    lastThreatSeenTime: 0,
    safeChat: null,
    startAnnounced: false,
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

describe('unit: BehaviorCaptureThreat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindClosestCreeper.mockReturnValue(null);
    mockFindClosestHostileMobRaw.mockReturnValue(null);
    mockFindShieldItem.mockReturnValue(null);
    mockIsShieldUsable.mockReturnValue(true);
    mockGoalXZ.mockImplementation((x: number, z: number) => ({ x, z }));
  });

  test('captures creeper threat into context and announces', () => {
    const creeper = makeCreeper(5, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ safeChat: bot.safeChat });
    const behavior = new BehaviorCaptureThreat(bot, ctx);

    behavior.onStateEntered();

    expect(ctx.threatLabel).toBe('Creeper');
    expect(ctx.lastKnownThreatPos).toEqual({ x: 5, y: 64, z: 0 });
    expect(ctx.startAnnounced).toBe(true);
    expect(bot.safeChat).toHaveBeenCalledWith('fleeing Creeper');
    expect(behavior.isFinished()).toBe(true);
    expect(behavior.foundThreat()).toBe(true);
  });

  test('finishes with foundThreat=false when no threat present', () => {
    const bot = makeBot();
    const ctx = makeCtx({ safeChat: bot.safeChat });
    const behavior = new BehaviorCaptureThreat(bot, ctx);

    behavior.onStateEntered();

    expect(ctx.startAnnounced).toBe(false);
    expect(bot.safeChat).not.toHaveBeenCalled();
    expect(behavior.isFinished()).toBe(true);
    expect(behavior.foundThreat()).toBe(false);
  });

  test('does not announce twice when re-entered with startAnnounced already set', () => {
    const creeper = makeCreeper(5, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ safeChat: bot.safeChat, startAnnounced: true });
    const behavior = new BehaviorCaptureThreat(bot, ctx);

    behavior.onStateEntered();

    expect(bot.safeChat).not.toHaveBeenCalled();
    expect(behavior.foundThreat()).toBe(true);
  });

  test('falls back to entity.name when displayName missing', () => {
    mockFindClosestCreeper.mockReturnValue({
      name: 'zombie',
      position: { x: 5, y: 64, z: 0 }
    });
    const bot = makeBot();
    const ctx = makeCtx({ safeChat: bot.safeChat });
    const behavior = new BehaviorCaptureThreat(bot, ctx);

    behavior.onStateEntered();

    expect(ctx.threatLabel).toBe('zombie');
  });
});

describe('unit: BehaviorFleeVisible', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFindClosestCreeper.mockReturnValue(null);
    mockFindClosestHostileMobRaw.mockReturnValue(null);
    mockFindShieldItem.mockReturnValue(null);
    mockIsShieldUsable.mockReturnValue(true);
    mockGoalXZ.mockImplementation((x: number, z: number) => ({ x, z }));
  });
  afterEach(() => jest.useRealTimers());

  test('sets initial pathfinder goal on entry from ctx.lastKnownThreatPos', () => {
    const bot = makeBot();
    const ctx = makeCtx({
      threatLabel: 'Creeper',
      lastKnownThreatPos: { x: 5, y: 64, z: 0 },
      lastThreatSeenTime: Date.now()
    });
    const behavior = new BehaviorFleeVisible(bot, ctx);

    behavior.onStateEntered();

    expect(bot.pathfinder.setGoal).toHaveBeenCalled();
  });

  test('does not set goal when ctx.lastKnownThreatPos is null', () => {
    const bot = makeBot();
    const ctx = makeCtx({ lastKnownThreatPos: null });
    const behavior = new BehaviorFleeVisible(bot, ctx);

    behavior.onStateEntered();

    expect(bot.pathfinder.setGoal).not.toHaveBeenCalled();
  });

  test('finishes with exitReason=shield when shield acquired mid-update', () => {
    const creeper = makeCreeper(5, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ lastKnownThreatPos: { x: 5, y: 64, z: 0 } });
    const behavior = new BehaviorFleeVisible(bot, ctx);
    behavior.onStateEntered();

    mockFindShieldItem.mockReturnValue({ name: 'shield', maxDurability: 336, durabilityUsed: 0 });
    mockIsShieldUsable.mockReturnValue(true);
    behavior.update();

    expect(behavior.isFinished()).toBe(true);
    expect(behavior.exitReason()).toBe('shield');
  });

  test('finishes with exitReason=safe when threat is beyond FLEE_RADIUS', () => {
    const creeper = makeCreeper(35, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ lastKnownThreatPos: { x: 35, y: 64, z: 0 } });
    const behavior = new BehaviorFleeVisible(bot, ctx);
    behavior.onStateEntered();

    behavior.update();

    expect(behavior.isFinished()).toBe(true);
    expect(behavior.exitReason()).toBe('safe');
  });

  test('signals lostThreat() when getThreat returns null', () => {
    const creeper = makeCreeper(5, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ lastKnownThreatPos: { x: 5, y: 64, z: 0 } });
    const behavior = new BehaviorFleeVisible(bot, ctx);
    behavior.onStateEntered();

    mockFindClosestCreeper.mockReturnValue(null);
    behavior.update();

    expect(behavior.lostThreat()).toBe(true);
    expect(behavior.isFinished()).toBe(false);
  });

  test('updates ctx.lastKnownThreatPos on each visible observation', () => {
    const creeper = makeCreeper(5, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ lastKnownThreatPos: { x: 1, y: 64, z: 1 } });
    const behavior = new BehaviorFleeVisible(bot, ctx);
    behavior.onStateEntered();

    creeper.position.x = 6;
    behavior.update();

    expect(ctx.lastKnownThreatPos).toEqual({ x: 6, y: 64, z: 0 });
  });

  test('refreshes pathfinder goal after GOAL_REFRESH_MS with sufficient direction change', () => {
    const creeper = makeCreeper(5, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ lastKnownThreatPos: { x: 5, y: 64, z: 0 } });
    const behavior = new BehaviorFleeVisible(bot, ctx);
    behavior.onStateEntered();
    const callsAfterEnter = bot.pathfinder.setGoal.mock.calls.length;

    jest.advanceTimersByTime(800);
    // move creeper far enough to clear the GOAL_CHANGE_THRESHOLD of 2 blocks
    creeper.position.x = -10;
    behavior.update();

    expect(bot.pathfinder.setGoal.mock.calls.length).toBeGreaterThan(callsAfterEnter);
  });

  test('update() is a no-op when finished is already true', () => {
    const creeper = makeCreeper(35, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    const bot = makeBot();
    const ctx = makeCtx({ lastKnownThreatPos: { x: 35, y: 64, z: 0 } });
    const behavior = new BehaviorFleeVisible(bot, ctx);
    behavior.onStateEntered();

    behavior.update(); // transitions to finished/safe
    const callsBefore = bot.pathfinder.setGoal.mock.calls.length;
    behavior.update(); // should be ignored

    expect(bot.pathfinder.setGoal.mock.calls.length).toBe(callsBefore);
  });
});

describe('unit: BehaviorFleeFromMemory', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFindClosestCreeper.mockReturnValue(null);
    mockFindClosestHostileMobRaw.mockReturnValue(null);
    mockFindShieldItem.mockReturnValue(null);
    mockIsShieldUsable.mockReturnValue(true);
    mockGoalXZ.mockImplementation((x: number, z: number) => ({ x, z }));
  });
  afterEach(() => jest.useRealTimers());

  test('continues fleeing within memory window and sets a goal on entry', () => {
    const bot = makeBot({ health: 8, maxHealth: 20 });
    const ctx = makeCtx({
      lastKnownThreatPos: { x: 5, y: 64, z: 0 },
      lastThreatSeenTime: Date.now()
    });
    const behavior = new BehaviorFleeFromMemory(bot, ctx);
    behavior.onStateEntered();

    expect(bot.pathfinder.setGoal).toHaveBeenCalled();
    expect(behavior.isFinished()).toBe(false);
  });

  test('finishes with exitReason=memory after FLEE_MEMORY_MS elapsed', () => {
    const bot = makeBot({ health: 8, maxHealth: 20 });
    const ctx = makeCtx({
      lastKnownThreatPos: { x: 5, y: 64, z: 0 },
      lastThreatSeenTime: Date.now()
    });
    const behavior = new BehaviorFleeFromMemory(bot, ctx);
    behavior.onStateEntered();

    jest.advanceTimersByTime(FLEE_MEMORY_MS + 100);
    behavior.update();

    expect(behavior.isFinished()).toBe(true);
    expect(behavior.exitReason()).toBe('memory');
  });

  test('signals threatReappeared() when getThreat returns non-null', () => {
    const bot = makeBot({ health: 8, maxHealth: 20 });
    const ctx = makeCtx({
      lastKnownThreatPos: { x: 5, y: 64, z: 0 },
      lastThreatSeenTime: Date.now()
    });
    const behavior = new BehaviorFleeFromMemory(bot, ctx);
    behavior.onStateEntered();

    const creeper = makeCreeper(6, 0);
    mockFindClosestCreeper.mockReturnValue(creeper);
    behavior.update();

    expect(behavior.threatReappeared()).toBe(true);
    expect(behavior.isFinished()).toBe(false);
  });

  test('finishes with exitReason=safe when distance from last-known exceeds FLEE_RADIUS', () => {
    const botPos: any = {
      x: 0,
      y: 64,
      z: 0,
      distanceTo(other: any) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dz = this.z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    };
    const bot = makeBot({
      health: 8,
      maxHealth: 20,
      entity: { position: botPos, yaw: 0, pitch: 0 }
    });
    const ctx = makeCtx({
      lastKnownThreatPos: { x: 5, y: 64, z: 0 },
      lastThreatSeenTime: Date.now()
    });
    const behavior = new BehaviorFleeFromMemory(bot, ctx);
    behavior.onStateEntered();

    botPos.x = 40;
    behavior.update();

    expect(behavior.isFinished()).toBe(true);
    expect(behavior.exitReason()).toBe('safe');
  });

  test('finishes with exitReason=shield when shield acquired mid-update', () => {
    const bot = makeBot({ health: 8, maxHealth: 20 });
    const ctx = makeCtx({
      lastKnownThreatPos: { x: 5, y: 64, z: 0 },
      lastThreatSeenTime: Date.now()
    });
    const behavior = new BehaviorFleeFromMemory(bot, ctx);
    behavior.onStateEntered();

    mockFindShieldItem.mockReturnValue({ name: 'shield', maxDurability: 336, durabilityUsed: 0 });
    mockIsShieldUsable.mockReturnValue(true);
    behavior.update();

    expect(behavior.isFinished()).toBe(true);
    expect(behavior.exitReason()).toBe('shield');
  });

  test('does not mutate ctx.lastThreatSeenTime on its own', () => {
    const bot = makeBot({ health: 8, maxHealth: 20 });
    const seen = Date.now() - 100;
    const ctx = makeCtx({
      lastKnownThreatPos: { x: 5, y: 64, z: 0 },
      lastThreatSeenTime: seen
    });
    const behavior = new BehaviorFleeFromMemory(bot, ctx);
    behavior.onStateEntered();
    behavior.update();

    expect(ctx.lastThreatSeenTime).toBe(seen);
  });
});
