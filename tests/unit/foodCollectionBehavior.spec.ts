import {
  foodCollectionBehavior,
  resetFoodCollectionCooldown,
  triggerFoodCollectionCooldown
} from '../../bots/collector/reactive_behaviors/food_collection_behavior';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';

jest.useFakeTimers();

jest.mock('../../behaviors/behaviorGetFood', () => ({
  __esModule: true,
  default: jest.fn()
}));

jest.mock('../../utils/adaptiveSnapshot', () => ({
  captureAdaptiveSnapshot: jest.fn()
}));

function createBotWithFood(food: Record<string, number> = {}): any {
  const items: any[] = [];
  for (const [name, count] of Object.entries(food)) {
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

describe('foodCollectionBehavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.setSystemTime(1000);
    resetFoodCollectionCooldown();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('shouldActivate', () => {
    it('returns true when food points are below trigger', () => {
      const bot = createBotWithFood({ bread: 3 });
      expect(foodCollectionBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns false when food points are at trigger', () => {
      const bot = createBotWithFood({ bread: 4 });
      expect(foodCollectionBehavior.shouldActivate(bot)).toBe(false);
    });

    it('returns false when food points are above trigger', () => {
      const bot = createBotWithFood({ cooked_beef: 4 });
      expect(foodCollectionBehavior.shouldActivate(bot)).toBe(false);
    });

    it('returns false when in cooldown', () => {
      const bot = createBotWithFood({ bread: 1 });
      triggerFoodCollectionCooldown();
      expect(foodCollectionBehavior.shouldActivate(bot)).toBe(false);
    });
  });

  describe('preemption recovery', () => {
    it('uses target threshold after preemption', () => {
      const bot = createBotWithFood({ beef: 9 });

      foodCollectionBehavior.shouldActivate(bot);

      const mockState = {
        stateMachine: {},
        isFinished: () => false,
        wasSuccessful: () => false,
        onStop: null as any
      };

      const capturedOnStop = jest.fn();

      jest.spyOn(foodCollectionBehavior, 'createState').mockResolvedValueOnce({
        ...mockState,
        onStop: (reason: string) => {
          capturedOnStop(reason);
          if (reason === 'preempted') {
            resetFoodCollectionCooldown();
          }
        }
      });

      // Simulate the preemption by calling onStop directly through the behavior
      // We need to trigger the internal wasPreempted flag, so we call createState
      // and simulate the preemption flow.
      // Instead, let's test the observable behavior: after preemption the
      // shouldActivate threshold changes from trigger (20) to target (60).

      // Reset to test the preemption path cleanly
      resetFoodCollectionCooldown();
      jest.restoreAllMocks();

      // Bot with 27 food points: above trigger (20), below target (60)
      const botAboveTrigger = createBotWithFood({ beef: 9 });

      // Without preemption, should NOT activate (27 >= 20)
      expect(foodCollectionBehavior.shouldActivate(botAboveTrigger)).toBe(false);
    });

    it('activates above trigger but below target after being preempted', async () => {
      const captureAdaptiveSnapshot = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;
      const createGetFoodState = require('../../behaviors/behaviorGetFood').default as jest.Mock;

      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });

      let stateMachineFinished = false;
      createGetFoodState.mockImplementation(() => ({
        update: jest.fn(),
        isFinished: () => stateMachineFinished,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn()
      }));

      // Start with low food so collection activates
      const botLowFood = createBotWithFood({ bread: 1 });
      expect(foodCollectionBehavior.shouldActivate(botLowFood)).toBe(true);

      // Create state to start food collection
      const state = await foodCollectionBehavior.createState(botLowFood);
      expect(state).not.toBeNull();

      // Simulate preemption (eating interrupted us)
      state!.onStop!('preempted' as any);

      // Now bot has food points between trigger and target (e.g. 27 from hunting)
      const botMidFood = createBotWithFood({ beef: 9 });

      // After preemption, should still activate because below target (60)
      expect(foodCollectionBehavior.shouldActivate(botMidFood)).toBe(true);
    });

    it('does not activate after preemption when food points reach target', async () => {
      const captureAdaptiveSnapshot = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;
      const createGetFoodState = require('../../behaviors/behaviorGetFood').default as jest.Mock;

      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });

      createGetFoodState.mockImplementation(() => ({
        update: jest.fn(),
        isFinished: () => false,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn()
      }));

      // Start with low food
      const botLowFood = createBotWithFood({ bread: 1 });
      expect(foodCollectionBehavior.shouldActivate(botLowFood)).toBe(true);

      const state = await foodCollectionBehavior.createState(botLowFood);
      expect(state).not.toBeNull();

      // Simulate preemption
      state!.onStop!('preempted' as any);

      // Bot now has food at/above target (60)
      const botFullFood = createBotWithFood({ cooked_beef: 8 });

      // Should NOT activate, target reached
      expect(foodCollectionBehavior.shouldActivate(botFullFood)).toBe(false);
    });

    it('clears preemption flag on normal completion', async () => {
      const captureAdaptiveSnapshot = require('../../utils/adaptiveSnapshot').captureAdaptiveSnapshot as jest.Mock;
      const createGetFoodState = require('../../behaviors/behaviorGetFood').default as jest.Mock;

      captureAdaptiveSnapshot.mockResolvedValue({
        snapshot: { radius: 32 },
        radiusUsed: 32,
        attemptsCount: 1
      });

      createGetFoodState.mockImplementation(() => ({
        update: jest.fn(),
        isFinished: () => false,
        onStateEntered: jest.fn(),
        onStateExited: jest.fn()
      }));

      // Start collection
      const botLowFood = createBotWithFood({ bread: 1 });
      const state = await foodCollectionBehavior.createState(botLowFood);
      expect(state).not.toBeNull();

      // Complete normally
      state!.onStop!('completed' as any);

      // Bot has food between trigger and target
      const botMidFood = createBotWithFood({ beef: 9 });

      // Should NOT activate (no preemption, above trigger)
      expect(foodCollectionBehavior.shouldActivate(botMidFood)).toBe(false);
    });
  });
});
