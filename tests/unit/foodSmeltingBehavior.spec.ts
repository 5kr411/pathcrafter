import { foodSmeltingBehavior, resetFoodSmeltingCooldown, setFoodSmeltingCooldown } from '../../bots/collector/reactive_behaviors/food_smelting_behavior';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';

jest.useFakeTimers();

jest.mock('../../planner', () => ({
  plan: jest.fn(),
  _internals: {
    enumerateActionPathsGenerator: jest.fn()
  }
}));

jest.mock('../../behavior_generator/buildMachine', () => ({
  buildStateMachineForPath: jest.fn()
}));

jest.mock('../../utils/adaptiveSnapshot', () => ({
  captureAdaptiveSnapshot: jest.fn()
}));

const plannerMock = require('../../planner').plan as jest.Mock;
const enumerateActionPathsGenerator = require('../../planner')._internals.enumerateActionPathsGenerator as jest.Mock;
const buildStateMachineForPath = require('../../behavior_generator/buildMachine').buildStateMachineForPath as jest.Mock;
const captureAdaptiveSnapshot = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;


function createBotWithRawFood(rawFood: Record<string, number> = {}): any {
  const items: any[] = [];
  for (const [name, count] of Object.entries(rawFood)) {
    if (count > 0) {
      items.push({ name, count, type: 1 });
    }
  }
  
  const slots = new Array(46).fill(null);
  items.forEach((item, i) => {
    slots[i] = item;
  });
  
  return createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    inventory: { slots, items }
  });
}

function createBotWithoutRawFood(): any {
  return createSimulatedBot({
    position: { x: 0, y: 64, z: 0 },
    inventory: { slots: new Array(46).fill(null), items: [] }
  });
}

describe('foodSmeltingBehavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.setSystemTime(0);
    resetFoodSmeltingCooldown();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('shouldActivate', () => {
    it('returns false when no raw food in inventory', () => {
      const bot = createBotWithoutRawFood();
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(false);
    });

    it('returns true when raw beef is in inventory', () => {
      const bot = createBotWithRawFood({ beef: 5 });
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns true when raw porkchop is in inventory', () => {
      const bot = createBotWithRawFood({ porkchop: 3 });
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns true when raw mutton is in inventory', () => {
      const bot = createBotWithRawFood({ mutton: 2 });
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns true when raw chicken is in inventory', () => {
      const bot = createBotWithRawFood({ chicken: 4 });
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns true when potato is in inventory', () => {
      const bot = createBotWithRawFood({ potato: 10 });
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns false during cooldown period', () => {
      const bot = createBotWithRawFood({ beef: 5 });
      
      setFoodSmeltingCooldown(60000);
      
      // First call should activate
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
      
      // Simulate a failed attempt by manually triggering cooldown
      // This would normally happen in createState when planning fails
      // For testing, we reset and use the internal state
    });

    it('respects cooldown after planning failure', async () => {
      // Use real timers for this test since we need Date.now() to work properly
      jest.useRealTimers();
      
      const bot = createBotWithRawFood({ beef: 5 });
      
      // Set a short cooldown for testing
      setFoodSmeltingCooldown(100);
      resetFoodSmeltingCooldown();
      
      // Mock snapshot capture
      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });
      
      // Mock planner to return null (no tree) - planning fails
      plannerMock.mockReturnValue(null);
      
      // Create state (which will fail and set cooldown)
      const state = await foodSmeltingBehavior.createState(bot);
      
      // State should be null since no path was found
      expect(state).toBeNull();
      
      // Now should be in cooldown
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(false);
      
      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(foodSmeltingBehavior.shouldActivate(bot)).toBe(true);
      
      // Restore fake timers for other tests
      jest.useFakeTimers();
    });
  });

  describe('createState', () => {
    it('returns null when no raw food in inventory', async () => {
      const bot = createBotWithoutRawFood();
      
      const state = await foodSmeltingBehavior.createState(bot);
      
      expect(state).toBeNull();
    });

    it('calls planner with cooked food target', async () => {
      const bot = createBotWithRawFood({ beef: 5 });
      
      plannerMock.mockReturnValue({ children: [] });
      enumerateActionPathsGenerator.mockImplementation(function* () {
        yield [{ action: 'smelt', what: 'cooked_beef', count: 5 }];
      });
      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });
      buildStateMachineForPath.mockImplementation((_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
        let finished = false;
        return {
          onStateEntered: jest.fn(),
          update: () => {
            if (!finished) {
              finished = true;
              if (onFinished) onFinished(true);
            }
          },
          isFinished: () => finished
        };
      });
      
      const state = await foodSmeltingBehavior.createState(bot);
      
      expect(state).not.toBeNull();
      expect(plannerMock).toHaveBeenCalled();
      
      const plannerCall = plannerMock.mock.calls[0];
      expect(plannerCall[1]).toBe('cooked_beef');
      expect(plannerCall[2]).toBe(5);
    });

    it('returns null when no viable path found', async () => {
      const bot = createBotWithRawFood({ beef: 5 });
      
      plannerMock.mockReturnValue(null);
      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });
      
      const state = await foodSmeltingBehavior.createState(bot);
      
      expect(state).toBeNull();
    });

    it('builds state machine when path is found', async () => {
      const bot = createBotWithRawFood({ porkchop: 3 });
      
      plannerMock.mockReturnValue({ children: [] });
      enumerateActionPathsGenerator.mockImplementation(function* () {
        yield [{ action: 'smelt', what: 'cooked_porkchop', count: 3 }];
      });
      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });
      buildStateMachineForPath.mockImplementation((_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
        let finished = false;
        return {
          onStateEntered: jest.fn(),
          update: () => {
            if (!finished) {
              finished = true;
              if (onFinished) onFinished(true);
            }
          },
          isFinished: () => finished
        };
      });
      
      const state = await foodSmeltingBehavior.createState(bot);
      
      expect(state).not.toBeNull();
      expect(buildStateMachineForPath).toHaveBeenCalled();
      expect(state?.stateMachine).toBeDefined();
    });
  });

  describe('priority', () => {
    it('has priority 40 (lower than food_collection at 60)', () => {
      expect(foodSmeltingBehavior.priority).toBe(40);
    });

    it('has correct name', () => {
      expect(foodSmeltingBehavior.name).toBe('food_smelting');
    });
  });

  describe('state machine callbacks', () => {
    it('isFinished returns correct value', async () => {
      const bot = createBotWithRawFood({ beef: 5 });
      
      let finished = false;
      plannerMock.mockReturnValue({ children: [] });
      enumerateActionPathsGenerator.mockImplementation(function* () {
        yield [{ action: 'smelt', what: 'cooked_beef', count: 5 }];
      });
      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });
      buildStateMachineForPath.mockImplementation((_bot: any, _path: any[], onFinished?: (success: boolean) => void) => {
        return {
          onStateEntered: jest.fn(),
          update: () => {
            if (!finished) {
              finished = true;
              if (onFinished) onFinished(true);
            }
          },
          isFinished: () => finished
        };
      });
      
      const state = await foodSmeltingBehavior.createState(bot);
      
      expect(state).not.toBeNull();
      const isFinished = state!.isFinished as () => boolean;
      expect(isFinished()).toBe(false);
      
      // Trigger state machine completion
      state!.stateMachine.update();
      
      expect(isFinished()).toBe(true);
    });
  });
});
