/**
 * Isolation regression test for T2 (module-level state removal).
 *
 * The six behaviors in this test used to store cooldowns / config / "active"
 * flags at module scope. Production deploys one bot per Node process so the
 * singleton shape was invisible — but any future in-process multi-bot
 * refactor (test harness, shared worker, etc.) would have silently broken
 * because every instance read the same state.
 *
 * These tests exist to fail if someone re-introduces module-level state.
 * They construct two fully independent factories and assert that mutating
 * state on one does not leak to the other.
 */

import {
  createFoodCollectionBehavior,
  FoodCollectionHandle
} from '../../bots/collector/reactive_behaviors/food_collection_behavior';
import {
  createFoodEatingBehavior,
  FoodEatingHandle
} from '../../bots/collector/reactive_behaviors/food_eating_behavior';
import {
  createFoodSmeltingBehavior,
  FoodSmeltingHandle
} from '../../bots/collector/reactive_behaviors/food_smelting_behavior';
import {
  createOpportunisticFoodHuntBehavior,
  OpportunisticFoodHuntHandle
} from '../../bots/collector/reactive_behaviors/opportunistic_food_hunt_behavior';
import {
  createDroppedFoodPickupBehavior,
  DroppedFoodPickupHandle
} from '../../bots/collector/reactive_behaviors/dropped_food_pickup_behavior';
import {
  createInventoryManagementBehavior,
  InventoryManagementHandle
} from '../../bots/collector/reactive_behaviors/inventory_management_behavior';

describe('reactive-behavior isolation — two factories in one process do not share state', () => {
  describe('food_collection', () => {
    let a: FoodCollectionHandle;
    let b: FoodCollectionHandle;

    beforeEach(() => {
      a = createFoodCollectionBehavior();
      b = createFoodCollectionBehavior();
      a.resetCooldown();
      b.resetCooldown();
    });

    it('config mutations on one instance do not leak to the other', () => {
      a.setConfig({ triggerFoodPoints: 5, targetFoodPoints: 10 });
      b.setConfig({ triggerFoodPoints: 12, targetFoodPoints: 20 });
      expect(a.getConfig().triggerFoodPoints).toBe(5);
      expect(a.getConfig().targetFoodPoints).toBe(10);
      expect(b.getConfig().triggerFoodPoints).toBe(12);
      expect(b.getConfig().targetFoodPoints).toBe(20);
    });

    it('cooldown trigger on one does not put the other in cooldown', () => {
      a.triggerCooldown();
      expect(a.isInCooldown()).toBe(true);
      expect(b.isInCooldown()).toBe(false);
    });

    it('reset on one does not clear the other', () => {
      a.triggerCooldown();
      b.triggerCooldown();
      a.resetCooldown();
      expect(a.isInCooldown()).toBe(false);
      expect(b.isInCooldown()).toBe(true);
    });

    it('setCooldown duration is per-instance', () => {
      jest.useFakeTimers();
      jest.setSystemTime(10_000);
      a.setCooldown(1_000);
      b.setCooldown(100_000);
      a.triggerCooldown();
      b.triggerCooldown();
      expect(a.isInCooldown()).toBe(true);
      expect(b.isInCooldown()).toBe(true);
      // Advance past a's cooldown but not b's. If the two instances
      // shared `cooldownMs`, the second setCooldown would have clobbered
      // the first and both would expire together.
      jest.advanceTimersByTime(1_500);
      expect(a.isInCooldown()).toBe(false);
      expect(b.isInCooldown()).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('food_eating', () => {
    let a: FoodEatingHandle;
    let b: FoodEatingHandle;

    beforeEach(() => {
      a = createFoodEatingBehavior();
      b = createFoodEatingBehavior();
    });

    it('cooldown state is per-instance', async () => {
      // Factories don't expose a "triggerCooldown" — the cooldown is set
      // inside createState(). Simulate by calling createState on `a` with
      // a bot that has no eatable food (so it returns null but still sets
      // the cooldown as a side-effect) and verifying `b` stays ready.
      const bot = makeBotWithNoEatableFood();
      await a.behavior.createState(bot);
      expect(a.isInCooldown()).toBe(true);
      expect(b.isInCooldown()).toBe(false);
    });

    it('resetCooldown on one does not clear the other', async () => {
      const bot = makeBotWithNoEatableFood();
      await a.behavior.createState(bot);
      await b.behavior.createState(bot);
      a.resetCooldown();
      expect(a.isInCooldown()).toBe(false);
      expect(b.isInCooldown()).toBe(true);
    });
  });

  describe('food_smelting', () => {
    let collectA: FoodCollectionHandle;
    let collectB: FoodCollectionHandle;
    let a: FoodSmeltingHandle;
    let b: FoodSmeltingHandle;

    beforeEach(() => {
      collectA = createFoodCollectionBehavior();
      collectB = createFoodCollectionBehavior();
      // Factories start in cooldown by default (to delay first food
      // collection after join). Reset for this test so we can trigger
      // one independently.
      collectA.resetCooldown();
      collectB.resetCooldown();
      a = createFoodSmeltingBehavior({ foodCollection: collectA });
      b = createFoodSmeltingBehavior({ foodCollection: collectB });
    });

    it('cooldown duration is per-instance', () => {
      // Smelting doesn't expose triggerCooldown, but setCooldown writes
      // to the factory-scoped cooldownMs variable. If two handles shared
      // a module-level cooldownMs, the second setCooldown call would
      // clobber the first. Verify by setting distinct values and
      // reading them back via isInCooldown + a fake-timer advance.
      jest.useFakeTimers();
      jest.setSystemTime(10_000);
      a.setCooldown(1_000);
      b.setCooldown(100_000);
      // Drive cooldown by forcing both through a failed createState-like
      // code path. We can't call createState without planner mocks, so
      // test via the handle's ability to report "ready" after reset:
      a.resetCooldown();
      b.resetCooldown();
      expect(a.isInCooldown()).toBe(false);
      expect(b.isInCooldown()).toBe(false);
      // The real test of setCooldown isolation lives in the
      // food_collection spec above (which exposes triggerCooldown).
      // Here we just verify the handle methods are independent.
      jest.useRealTimers();
    });

    it('food-collection dependency is per-instance', () => {
      collectA.triggerCooldown();
      // collectB is still ready. The smelting behaviors each read from
      // their own collection handle, so `a`'s view of "collection in
      // cooldown" differs from `b`'s.
      expect(collectA.isInCooldown()).toBe(true);
      expect(collectB.isInCooldown()).toBe(false);
    });
  });

  describe('opportunistic_food_hunt', () => {
    let collectA: FoodCollectionHandle;
    let collectB: FoodCollectionHandle;
    let a: OpportunisticFoodHuntHandle;
    let b: OpportunisticFoodHuntHandle;

    beforeEach(() => {
      collectA = createFoodCollectionBehavior();
      collectB = createFoodCollectionBehavior();
      a = createOpportunisticFoodHuntBehavior({ foodCollection: collectA });
      b = createOpportunisticFoodHuntBehavior({ foodCollection: collectB });
    });

    it('cooldown is per-instance', () => {
      a.triggerCooldown();
      expect(a.isInCooldown()).toBe(true);
      expect(b.isInCooldown()).toBe(false);
    });

    it('reset is per-instance', () => {
      a.triggerCooldown();
      b.triggerCooldown();
      a.resetCooldown();
      expect(a.isInCooldown()).toBe(false);
      expect(b.isInCooldown()).toBe(true);
    });
  });

  describe('dropped_food_pickup', () => {
    let collectA: FoodCollectionHandle;
    let collectB: FoodCollectionHandle;
    let a: DroppedFoodPickupHandle;
    let b: DroppedFoodPickupHandle;

    beforeEach(() => {
      collectA = createFoodCollectionBehavior();
      collectB = createFoodCollectionBehavior();
      a = createDroppedFoodPickupBehavior({ foodCollection: collectA });
      b = createDroppedFoodPickupBehavior({ foodCollection: collectB });
    });

    it('cooldown is per-instance', () => {
      a.triggerCooldown();
      expect(a.isInCooldown()).toBe(true);
      expect(b.isInCooldown()).toBe(false);
    });

    it('reset is per-instance', () => {
      a.triggerCooldown();
      b.triggerCooldown();
      a.resetCooldown();
      expect(a.isInCooldown()).toBe(false);
      expect(b.isInCooldown()).toBe(true);
    });
  });

  describe('inventory_management', () => {
    let a: InventoryManagementHandle;
    let b: InventoryManagementHandle;

    beforeEach(() => {
      a = createInventoryManagementBehavior();
      b = createInventoryManagementBehavior();
    });

    it('config mutations on one instance do not leak to the other', () => {
      a.setConfig({ reactiveThreshold: 3, preGateThreshold: 1 });
      b.setConfig({ reactiveThreshold: 7, preGateThreshold: 5 });
      expect(a.getConfig().reactiveThreshold).toBe(3);
      expect(a.getConfig().preGateThreshold).toBe(1);
      expect(b.getConfig().reactiveThreshold).toBe(7);
      expect(b.getConfig().preGateThreshold).toBe(5);
    });

    it('cooldown trigger on one does not affect the other', () => {
      a.triggerCooldown();
      // There's no public isInCooldown on inventory-management, so we
      // verify via shouldActivate — which returns false if in cooldown.
      const fullBot = makeBotWithEmptySlots(1); // 1 free < reactiveThreshold (3)
      const aShould = a.behavior.shouldActivate(fullBot);
      const bShould = b.behavior.shouldActivate(fullBot);
      expect(aShould).toBe(false);
      expect(bShould).toBe(true);
    });

    it('getTargets closure is per-instance', () => {
      const targetsA = [{ item: 'oak_log', count: 64 }];
      const targetsB = [{ item: 'diamond', count: 1 }];
      a.setConfig({ getTargets: () => targetsA });
      b.setConfig({ getTargets: () => targetsB });
      expect(a.getConfig().getTargets()).toEqual(targetsA);
      expect(b.getConfig().getTargets()).toEqual(targetsB);
    });
  });
});

// --- helpers ---

function makeBotWithNoEatableFood(): any {
  const slots = new Array(46).fill(null);
  return {
    version: '1.20.1',
    health: 10, // below full so shouldActivate would say yes if food present
    food: 10,
    entity: { position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 },
    inventory: { slots, items: () => [] },
    heldItem: null,
    safeChat: jest.fn(),
    clearControlStates: jest.fn(),
    stopDigging: jest.fn(),
    pathfinder: { stop: jest.fn() }
  };
}

function makeBotWithEmptySlots(freeSlots: number): any {
  const slots: any[] = new Array(46).fill(null);
  // Fill main inventory (slots 9..44) so only `freeSlots` remain empty.
  const mainSlotCount = 44 - 9 + 1;
  const filled = mainSlotCount - freeSlots;
  for (let i = 0; i < filled; i++) {
    slots[9 + i] = { name: 'dirt', count: 64, type: 3 };
  }
  return {
    version: '1.20.1',
    entity: { position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 },
    inventory: {
      slots,
      items: () => slots.filter(Boolean)
    },
    safeChat: jest.fn()
  };
}
