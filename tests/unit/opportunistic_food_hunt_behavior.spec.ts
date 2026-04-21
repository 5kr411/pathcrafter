jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLevel: jest.fn()
}));

const mockIsWorkstationLocked: jest.Mock = jest.fn(() => false);
jest.mock('../../utils/workstationLock', () => ({
  isWorkstationLocked: () => mockIsWorkstationLocked()
}));

const mockGetInventoryObject: jest.Mock = jest.fn(() => ({}));
jest.mock('../../utils/inventory', () => ({
  getInventoryObject: (bot: any) => mockGetInventoryObject(bot)
}));

const mockCalculateFoodPoints: jest.Mock = jest.fn(() => 0);
jest.mock('../../utils/foodConfig', () => ({
  calculateFoodPointsInInventory: (inv: any) => mockCalculateFoodPoints(inv),
  HUNTABLE_LAND_ANIMALS: [
    { entity: 'cow' },
    { entity: 'pig' },
    { entity: 'chicken' }
  ]
}));

const mockFindClosestHuntableAnimal: jest.Mock = jest.fn(() => null);
jest.mock('../../behaviors/huntForFoodHelpers', () => ({
  findClosestHuntableAnimal: (bot: any, a: any, b: any, c: any) =>
    mockFindClosestHuntableAnimal(bot, a, b, c)
}));

let mockInnerSM: any;
const mockCreateHuntEntityState: jest.Mock = jest.fn(() => mockInnerSM);
jest.mock('../../behaviors/behaviorHuntEntity', () => ({
  __esModule: true,
  default: (bot: any, targets: any) => mockCreateHuntEntityState(bot, targets)
}));

import {
  createOpportunisticFoodHuntBehavior,
  HUNT_TIMEOUT_MS
} from '../../bots/collector/reactive_behaviors/opportunistic_food_hunt_behavior';

/**
 * Each test builds its own factory instance so cooldown + throttled-log
 * state are per-test closures. Mirrors the per-bot isolation pattern
 * established in the T2 refactor on main.
 */
function makeFoodCollectionHandle(overrides: { isActive?: boolean; targetFoodPoints?: number } = {}) {
  return {
    isActive: () => overrides.isActive ?? false,
    getConfig: () => ({ targetFoodPoints: overrides.targetFoodPoints ?? 20 })
  } as any;
}

function makeHandle(overrides: { isActive?: boolean; targetFoodPoints?: number } = {}) {
  return createOpportunisticFoodHuntBehavior({
    foodCollection: makeFoodCollectionHandle(overrides)
  });
}

function makeBot(overrides: any = {}) {
  return {
    safeChat: jest.fn(),
    entity: { position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 },
    entities: {},
    on: jest.fn(),
    off: jest.fn(),
    removeListener: jest.fn(),
    ...overrides
  };
}

function makeInnerSM() {
  return {
    stateName: 'HuntInner',
    active: false,
    onStateEntered: jest.fn(),
    onStateExited: jest.fn(),
    update: jest.fn(),
    isFinished: jest.fn(() => false)
  };
}

function makeAnimalResult(animalType = 'cow') {
  return {
    entity: { name: animalType, position: { x: 5, y: 64, z: 0 } },
    animalType
  };
}

describe('unit: opportunistic_food_hunt_behavior (factory + NSM)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockIsWorkstationLocked.mockReturnValue(false);
    mockCalculateFoodPoints.mockReturnValue(0);
    mockFindClosestHuntableAnimal.mockReturnValue(null);
    mockInnerSM = makeInnerSM();
  });

  afterEach(() => jest.useRealTimers());

  describe('behavior properties', () => {
    test('has name', () => {
      expect(makeHandle().behavior.name).toBe('opportunistic_food_hunt');
    });

    test('has priority 57', () => {
      expect(makeHandle().behavior.priority).toBe(57);
    });
  });

  describe('shouldActivate', () => {
    test('false when workstation locked', () => {
      mockIsWorkstationLocked.mockReturnValue(true);
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      expect(makeHandle().behavior.shouldActivate(makeBot())).toBe(false);
    });

    test('false when food collection active', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      expect(makeHandle({ isActive: true }).behavior.shouldActivate(makeBot())).toBe(false);
    });

    test('false when food at or above target', () => {
      mockCalculateFoodPoints.mockReturnValue(25);
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      expect(makeHandle().behavior.shouldActivate(makeBot())).toBe(false);
    });

    test('false when no huntable animal nearby', () => {
      mockCalculateFoodPoints.mockReturnValue(0);
      mockFindClosestHuntableAnimal.mockReturnValue(null);
      expect(makeHandle().behavior.shouldActivate(makeBot())).toBe(false);
    });

    test('true when food low and huntable nearby', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      expect(makeHandle().behavior.shouldActivate(makeBot())).toBe(true);
    });
  });

  describe('createState', () => {
    test('returns null when no huntable animal', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(null);
      expect(makeHandle().behavior.createState(makeBot())).toBeNull();
    });

    test('builds NSM and announces hunt on entry', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult('pig'));
      const bot = makeBot();

      const result = makeHandle().behavior.createState(bot) as any;

      expect(result).not.toBeNull();
      expect(result.stateMachine).toBeDefined();
      expect(result.stateMachine.stateName).toBe('OpportunisticFoodHunt');
      expect(bot.safeChat).toHaveBeenCalledWith('hunting nearby pig for food');
    });

    test('passes the correct targets to createHuntEntityState', () => {
      const animal = makeAnimalResult('cow');
      mockFindClosestHuntableAnimal.mockReturnValue(animal);

      makeHandle().behavior.createState(makeBot());

      expect(mockCreateHuntEntityState).toHaveBeenCalled();
      const call = mockCreateHuntEntityState.mock.calls[0] as any[];
      const targets: any = call[1];
      expect(targets.entity).toBe(animal.entity);
      expect(targets.detectionRange).toBe(16);
      expect(targets.attackRange).toBe(3.5);
      expect(targets.entityFilter({ name: 'cow' })).toBe(true);
      expect(targets.entityFilter({ name: 'spider' })).toBe(false);
    });

    test('wasSuccessful true when inner completes before timeout', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const result = makeHandle().behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      mockInnerSM.isFinished.mockReturnValue(true);
      result.stateMachine.update(); // fires hunt -> exit (complete)

      expect(result.wasSuccessful()).toBe(true);
      expect(result.stateMachine.isFinished()).toBe(true);
    });

    test('wasSuccessful false when timeout transition fires', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const result = makeHandle().behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 100);
      result.stateMachine.update(); // fires hunt -> exit (timeout), onTransition markTimedOut

      expect(result.wasSuccessful()).toBe(false);
      expect(result.stateMachine.isFinished()).toBe(true);
    });

    test('isFinished is false while hunt is still active', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const result = makeHandle().behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      result.stateMachine.update();

      expect(result.stateMachine.isFinished()).toBe(false);
    });
  });

  describe('onStop + per-factory cooldown', () => {
    test('completed + timeout fires hunt-timed-out chat', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const result = makeHandle().behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 100);
      result.stateMachine.update();
      bot.safeChat.mockClear();
      result.onStop('completed');

      expect(bot.safeChat).toHaveBeenCalledWith('hunt timed out');
    });

    test('completed + success fires done-hunting chat', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult('chicken'));
      const bot = makeBot();
      const result = makeHandle().behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      mockInnerSM.isFinished.mockReturnValue(true);
      result.stateMachine.update();
      bot.safeChat.mockClear();
      result.onStop('completed');

      expect(bot.safeChat).toHaveBeenCalledWith('done hunting chicken');
    });

    test('timeout sets cooldown that blocks subsequent shouldActivate on same handle', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const handle = makeHandle();
      const result = handle.behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 100);
      result.stateMachine.update();
      result.onStop('completed'); // sets lastFailedAttempt on handle closure

      expect(handle.isInCooldown()).toBe(true);
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      expect(handle.behavior.shouldActivate(makeBot())).toBe(false);
    });

    test('resetCooldown() clears the cooldown', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const handle = makeHandle();
      const result = handle.behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 100);
      result.stateMachine.update();
      result.onStop('completed');

      expect(handle.isInCooldown()).toBe(true);
      handle.resetCooldown();
      expect(handle.isInCooldown()).toBe(false);
    });

    test('triggerCooldown() sets the cooldown manually', () => {
      const handle = makeHandle();
      expect(handle.isInCooldown()).toBe(false);
      handle.triggerCooldown();
      expect(handle.isInCooldown()).toBe(true);
    });

    test('preempted/aborted does NOT fire chat or set cooldown', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const handle = makeHandle();
      const result = handle.behavior.createState(bot) as any;

      result.stateMachine.onStateEntered();
      bot.safeChat.mockClear();
      result.onStop('preempted');

      expect(bot.safeChat).not.toHaveBeenCalled();
      expect(handle.isInCooldown()).toBe(false);
    });

    test('cooldown is per-factory-instance (isolation)', () => {
      mockFindClosestHuntableAnimal.mockReturnValue(makeAnimalResult());
      const bot = makeBot();
      const handleA = makeHandle();
      const handleB = makeHandle();

      const result = handleA.behavior.createState(bot) as any;
      result.stateMachine.onStateEntered();
      jest.advanceTimersByTime(HUNT_TIMEOUT_MS + 100);
      result.stateMachine.update();
      result.onStop('completed');

      expect(handleA.isInCooldown()).toBe(true);
      expect(handleB.isInCooldown()).toBe(false);
    });
  });
});
