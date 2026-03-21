import { stepWeight, computePathWeight } from '../../utils/pathUtils';
import { createTestActionStep, createVariantGroup } from '../testHelpers';
import {
  initWorkstationCostCache,
  getWorkstationCraftCost,
  isWorkstationCacheReady,
  clearWorkstationCostCache
} from '../../utils/workstationCostCache';

describe('computePathWeight delegates to stepWeight', () => {
  it('returns same result as summing stepWeight for each step', () => {
    const path = [
      createTestActionStep({ action: 'mine', what: createVariantGroup('one_of', 'oak_log'), count: 4 }),
      createTestActionStep({ action: 'craft', what: createVariantGroup('one_of', 'inventory'), count: 1 }),
    ];
    const expected = path.reduce((sum, step) => sum + stepWeight(step), 0);
    expect(computePathWeight(path)).toBe(expected);
    expect(expected).toBe(4001);
  });
});

describe('workstationCostCache', () => {
  it('is not ready before initialization', () => {
    expect(isWorkstationCacheReady()).toBe(false);
  });

  it('returns undefined for unknown items before init', () => {
    expect(getWorkstationCraftCost('crafting_table')).toBeUndefined();
  });

  describe('after initialization', () => {
    beforeAll(() => {
      initWorkstationCostCache('1.20.1', ['crafting_table', 'furnace']);
    });

    afterAll(() => {
      clearWorkstationCostCache();
    });

    it('is ready after initialization', () => {
      expect(isWorkstationCacheReady()).toBe(true);
    });

    it('caches crafting_table cost', () => {
      const cost = getWorkstationCraftCost('crafting_table');
      expect(cost).toBeDefined();
      expect(typeof cost).toBe('number');
      expect(cost).toBeGreaterThan(0);
    });

    it('caches furnace cost', () => {
      const cost = getWorkstationCraftCost('furnace');
      expect(cost).toBeDefined();
      expect(cost).toBeGreaterThan(0);
    });

    it('returns undefined for non-workstation items', () => {
      expect(getWorkstationCraftCost('oak_log')).toBeUndefined();
    });

    it('crafting_table cost reflects craft chain (mine log + craft planks + craft table)', () => {
      const cost = getWorkstationCraftCost('crafting_table');
      // mine 1 log = 1000, craft planks at inventory = 1, craft table at inventory = 1 => 1002
      // Must be greater than the direct mine cost (1000) to represent crafting overhead
      expect(cost).toBeGreaterThan(1000);
    });
  });

  it('clearWorkstationCostCache resets state', () => {
    initWorkstationCostCache('1.20.1', ['crafting_table']);
    expect(isWorkstationCacheReady()).toBe(true);
    clearWorkstationCostCache();
    expect(isWorkstationCacheReady()).toBe(false);
    expect(getWorkstationCraftCost('crafting_table')).toBeUndefined();
  });
});

describe('stepWeight with workstation penalty', () => {
  beforeAll(() => {
    initWorkstationCostCache('1.20.1', ['crafting_table', 'furnace']);
  });

  afterAll(() => {
    clearWorkstationCostCache();
  });

  it('penalizes mining a crafting_table above its craft-from-scratch cost', () => {
    const step = createTestActionStep({
      action: 'mine',
      what: createVariantGroup('one_of', 'crafting_table'),
      count: 1,
    });
    const weight = stepWeight(step);
    const craftCost = getWorkstationCraftCost('crafting_table')!;
    expect(weight).toBe(craftCost + 1);
    expect(weight).toBeGreaterThan(1000); // must be more than default mine cost
  });

  it('does not penalize mining a non-workstation block', () => {
    const step = createTestActionStep({
      action: 'mine',
      what: createVariantGroup('one_of', 'oak_log'),
      count: 1,
    });
    expect(stepWeight(step)).toBe(1000);
  });

  it('scales penalty by count', () => {
    const step = createTestActionStep({
      action: 'mine',
      what: createVariantGroup('one_of', 'crafting_table'),
      count: 3,
    });
    const craftCost = getWorkstationCraftCost('crafting_table')!;
    expect(stepWeight(step)).toBe((craftCost + 1) * 3);
  });

  it('falls back to 1000 * count when cache is not initialized', () => {
    clearWorkstationCostCache();
    const step = createTestActionStep({
      action: 'mine',
      what: createVariantGroup('one_of', 'crafting_table'),
      count: 1,
    });
    expect(stepWeight(step)).toBe(1000);
    // Re-init for remaining tests
    initWorkstationCostCache('1.20.1', ['crafting_table', 'furnace']);
  });
});
