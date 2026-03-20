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
      const bot = createBotWithFood({ apple: 2 });  // 8 points < trigger (10)
      expect(foodCollectionBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns false when food points are at trigger', () => {
      const bot = createBotWithFood({ bread: 2 });  // 10 points >= trigger (10)
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

});
