import {
  createFoodEatingBehavior,
  FoodEatingHandle
} from '../../bots/collector/reactive_behaviors/food_eating_behavior';
import { createSimulatedBot } from '../helpers/reactiveTestHarness';

jest.useFakeTimers();

function createBotWithFood(
  food: Record<string, number>,
  opts: { health?: number; hunger?: number } = {}
): any {
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
    health: opts.health ?? 20,
    food: opts.hunger ?? 20,
    inventory: { slots, items }
  });
}

describe('foodEatingBehavior.shouldActivate', () => {
  let handle: FoodEatingHandle;

  beforeEach(() => {
    handle = createFoodEatingBehavior();
    handle.resetCooldown();
  });

  it('does not eat when both health and hunger are full', () => {
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 20, hunger: 20 });
    expect(handle.behavior.shouldActivate(bot)).toBe(false);
  });

  it('eats when health is below full and hunger is below full', () => {
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 10, hunger: 18 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });

  it('eats when health is slightly below full and hunger is slightly below full', () => {
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 19, hunger: 19 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });

  it('eats when health is low even if hunger is high (but not full)', () => {
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 5, hunger: 19 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });

  it('does not eat when hunger is completely full even with low health', () => {
    // Minecraft won't let you eat at hunger 20
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 5, hunger: 20 });
    expect(handle.behavior.shouldActivate(bot)).toBe(false);
  });

  it('does not eat when no food is in inventory', () => {
    const bot = createBotWithFood({}, { health: 10, hunger: 10 });
    expect(handle.behavior.shouldActivate(bot)).toBe(false);
  });

  it('eats at hunger 15 when health is not full', () => {
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 15, hunger: 15 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });

  it('does not eat at hunger 19 when health is full and smallest food is 3 points', () => {
    // cooked_beef = 8 food points, hunger room = 1, can't eat without waste
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 20, hunger: 19 });
    expect(handle.behavior.shouldActivate(bot)).toBe(false);
  });

  it('eats at hunger 17 when health is full and smallest food is 3 points (beef)', () => {
    // beef (raw) = 3 food points, hunger room = 3, exactly fits
    const bot = createBotWithFood({ beef: 10 }, { health: 20, hunger: 17 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });

  it('does not eat at hunger 18 when health is full and smallest food is 3 points', () => {
    // beef = 3 food points, hunger room = 2, would waste
    const bot = createBotWithFood({ beef: 10 }, { health: 20, hunger: 18 });
    expect(handle.behavior.shouldActivate(bot)).toBe(false);
  });

  it('eats at hunger 10 when health is full', () => {
    const bot = createBotWithFood({ cooked_beef: 10 }, { health: 20, hunger: 10 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });

  it('does not eat rotten_flesh when health is full', () => {
    const bot = createBotWithFood({ rotten_flesh: 10 }, { health: 20, hunger: 10 });
    expect(handle.behavior.shouldActivate(bot)).toBe(false);
  });

  it('eats rotten_flesh when health is below full', () => {
    const bot = createBotWithFood({ rotten_flesh: 10 }, { health: 10, hunger: 10 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });

  it('does not eat spider_eye when health is full', () => {
    const bot = createBotWithFood({ spider_eye: 5 }, { health: 20, hunger: 10 });
    expect(handle.behavior.shouldActivate(bot)).toBe(false);
  });

  it('prefers safe food over negative-effect food', () => {
    // Has both cooked_beef and rotten_flesh at full health — should still eat (cooked_beef)
    const bot = createBotWithFood({ cooked_beef: 5, rotten_flesh: 10 }, { health: 20, hunger: 10 });
    expect(handle.behavior.shouldActivate(bot)).toBe(true);
  });
});
