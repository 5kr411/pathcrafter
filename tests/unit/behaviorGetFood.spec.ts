import createGetFoodState from '../../behaviors/behaviorGetFood';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';
import { HUNTABLE_LAND_ANIMALS } from '../../utils/foodConfig';

jest.useFakeTimers();

jest.mock('../../behaviors/behaviorHuntForFish', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((_bot: any, targets: any) => {
    let finished = false;
    let foodGained = 0;
    return {
      onStateEntered: jest.fn(),
      update: jest.fn(() => {
        if (!finished) {
          finished = true;
          const mockGain = (global as any).__mockFishFoodGain ?? 0;
          foodGained = mockGain;
          if (targets.onComplete) {
            targets.onComplete(mockGain > 0, mockGain);
          }
        }
      }),
      isFinished: () => finished,
      getFoodGained: () => foodGained
    };
  })
}));

jest.mock('../../behaviors/behaviorHuntForFood', () => {
  return jest.fn().mockImplementation((_bot: any, targets: any) => {
    let finished = false;
    let foodGained = 0;
    return {
      onStateEntered: jest.fn(),
      update: jest.fn(() => {
        if (!finished) {
          finished = true;
          const mockGain = (global as any).__mockHuntFoodGain ?? 4;
          foodGained = mockGain;
          if (targets.onComplete) {
            targets.onComplete(mockGain > 0, mockGain);
          }
        }
      }),
      isFinished: () => finished,
      getFoodGained: () => foodGained
    };
  });
});

jest.mock('../../behaviors/behaviorCollectBread', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((_bot: any, targets: any) => {
    let finished = false;
    return {
      onStateEntered: jest.fn(),
      update: jest.fn(() => {
        if (!finished) {
          finished = true;
          if (targets.onComplete) targets.onComplete(false, 0);
        }
      }),
      isFinished: () => finished
    };
  }),
  BREAD_HUNGER_POINTS: 5
}));

jest.mock('../../behaviors/behaviorCollectBerries', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((_bot: any, targets: any) => {
    let finished = false;
    return {
      onStateEntered: jest.fn(),
      update: jest.fn(() => {
        if (!finished) {
          finished = true;
          if (targets.onComplete) targets.onComplete(false, 0, null);
        }
      }),
      isFinished: () => finished
    };
  }),
  BERRY_HUNGER_POINTS: 2
}));

jest.mock('../../behaviors/behaviorCollectMelon', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((_bot: any, targets: any) => {
    let finished = false;
    return {
      onStateEntered: jest.fn(),
      update: jest.fn(() => {
        if (!finished) {
          finished = true;
          if (targets.onComplete) targets.onComplete(false, 0);
        }
      }),
      isFinished: () => finished
    };
  }),
  MELON_SLICE_HUNGER_POINTS: 2
}));

const createHuntForFoodState = require('../../behaviors/behaviorHuntForFood');
const createHuntForFishState = require('../../behaviors/behaviorHuntForFish').default;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function advanceTimersAndFlush(ms: number = 500): Promise<void> {
  jest.advanceTimersByTime(ms);
  await flushMicrotasks();
}

function createBotWithAnimals(animalCount: number = 1): any {
  const entities: Record<string, any> = {};
  for (let i = 0; i < animalCount; i++) {
    entities[`entity_${i}`] = {
      name: HUNTABLE_LAND_ANIMALS[i % HUNTABLE_LAND_ANIMALS.length].entity,
      position: { x: 10 + i, y: 64, z: 10 }
    };
  }
  return createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    entities,
    food: 0,
    inventory: { slots: new Array(46).fill(null) }
  });
}

function createBotWithoutAnimals(): any {
  return createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    entities: {},
    food: 0,
    inventory: { slots: new Array(46).fill(null) }
  });
}

describe('behaviorGetFood', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).__mockHuntFoodGain = 4;
    (global as any).__mockFishFoodGain = 0;
  });

  afterEach(() => {
    delete (global as any).__mockHuntFoodGain;
    delete (global as any).__mockFishFoodGain;
    jest.clearAllTimers();
  });

  describe('selectNextSource - hunt prioritization', () => {
    it('always tries hunting first before block-based sources', async () => {
      const bot = createBotWithoutAnimals();
      
      // Make hunt fail so we can verify it was tried first
      (global as any).__mockHuntFoodGain = 0;

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await flushMicrotasks();

      // Run enough cycles for first source selection
      for (let i = 0; i < 10; i++) {
        await advanceTimersAndFlush(500);
        stateMachine.update();
        await flushMicrotasks();
      }

      // Hunting should be the first thing tried, even with no animals
      expect(createHuntForFoodState).toHaveBeenCalled();
    });

    it('selects hunt when animals are nearby', async () => {
      const bot = createBotWithAnimals(3);

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await flushMicrotasks();
      
      // advance timers for waitForEntities and run multiple update cycles
      for (let i = 0; i < 10; i++) {
        await advanceTimersAndFlush(500);
        stateMachine.update();
        await flushMicrotasks();
      }

      expect(createHuntForFoodState).toHaveBeenCalled();
    });

    it('continues hunting when animals are nearby and food not reached', async () => {
      const bot = createBotWithAnimals(5);

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await advanceTimersAndFlush(2500);

      for (let i = 0; i < 10; i++) {
        stateMachine.update();
        await flushMicrotasks();
      }

      const huntCalls = createHuntForFoodState.mock.calls.length;
      expect(huntCalls).toBeGreaterThan(1);
    });

    it('resets hunt attempts when food is gained', async () => {
      const bot = createBotWithAnimals(5);

      (global as any).__mockHuntFoodGain = 4;

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await advanceTimersAndFlush(2500);

      for (let i = 0; i < 15; i++) {
        stateMachine.update();
        await flushMicrotasks();
      }

      const huntCalls = createHuntForFoodState.mock.calls.length;
      expect(huntCalls).toBeGreaterThan(5);
    });

    it('limits hunt attempts when hunts fail repeatedly', async () => {
      const bot = createBotWithAnimals(5);

      (global as any).__mockHuntFoodGain = 0;

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await advanceTimersAndFlush(2500);

      for (let i = 0; i < 30; i++) {
        stateMachine.update();
        await flushMicrotasks();
      }

      const huntCalls = createHuntForFoodState.mock.calls.length;
      expect(huntCalls).toBeLessThanOrEqual(10);
    });
  });

  describe('selectNextSource - fallback sources', () => {
    it('tries hunting first even when no animals nearby, then falls back to bread', async () => {
      const bot = createBotWithoutAnimals();
      
      // Make hunt fail (no food gained) so it moves to bread
      (global as any).__mockHuntFoodGain = 0;

      const behaviorCollectBread = require('../../behaviors/behaviorCollectBread').default;

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await flushMicrotasks();

      // advance timers for waitForEntities and run multiple update cycles
      // First hunt attempt will happen, then it will fall back to bread
      for (let i = 0; i < 15; i++) {
        await advanceTimersAndFlush(500);
        stateMachine.update();
        await flushMicrotasks();
      }

      // Hunting should have been tried first
      expect(createHuntForFoodState).toHaveBeenCalled();
      // Then bread should be tried as fallback
      expect(behaviorCollectBread).toHaveBeenCalled();
    });

    it('completes successfully when target food reached', async () => {
      const bot = createBotWithAnimals(5);
      
      // put food items in inventory that give 40+ points
      bot.inventory.slots[0] = { name: 'cooked_beef', count: 5, type: 364 };
      bot.inventory.items = jest.fn().mockReturnValue([
        { name: 'cooked_beef', count: 5, type: 364 }
      ]);

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await advanceTimersAndFlush(2500);

      for (let i = 0; i < 5; i++) {
        stateMachine.update();
        await flushMicrotasks();
      }

      expect(stateMachine.isFinished()).toBe(true);
      expect(stateMachine.wasSuccessful()).toBe(true);
    });
  });

  describe('selectNextSource - fish source', () => {
    it('fish hunting gains nothing when HUNTABLE_WATER_ANIMALS is empty', async () => {
      const bot = createBotWithoutAnimals();

      (global as any).__mockHuntFoodGain = 0;
      (global as any).__mockFishFoodGain = 0;

      const stateMachine = createGetFoodState(bot, {
        targetFoodPoints: 40
      });

      stateMachine.onStateEntered();
      await flushMicrotasks();

      for (let i = 0; i < 30; i++) {
        await advanceTimersAndFlush(500);
        stateMachine.update();
        await flushMicrotasks();
      }

      // Fish source may get an initial attempt but gains nothing with an empty list.
      // Verify it never retries beyond the first attempt.
      expect(createHuntForFishState.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });
});
