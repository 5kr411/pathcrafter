import { stepDependenciesSatisfied } from '../../bots/collector/plan_validation';
import type { ActionStep, VariantGroup } from '../../action_tree/types';

// Helper to create a VariantGroup
function vg<T>(mode: 'one_of' | 'any_of', ...values: T[]): VariantGroup<T> {
  return {
    mode,
    variants: values.map(v => ({ value: v })),
  };
}

// Helper to create a minimal ActionStep
function makeStep(overrides: Partial<ActionStep> & Pick<ActionStep, 'action'>): ActionStep {
  return {
    variantMode: 'one_of',
    what: vg('one_of', 'dummy'),
    count: 1,
    ...overrides,
  } as ActionStep;
}

describe('stepDependenciesSatisfied', () => {
  // ── craft ──
  describe('craft action', () => {
    it('returns true when all ingredients are sufficient', () => {
      const step = makeStep({
        action: 'craft',
        count: 1,
        ingredients: vg('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'stick', perCraftCount: 2 },
        ]),
      });
      const inv = { oak_planks: 4, stick: 2 };
      expect(stepDependenciesSatisfied(step, inv)).toBe(true);
    });

    it('returns false when an ingredient is missing', () => {
      const step = makeStep({
        action: 'craft',
        count: 1,
        ingredients: vg('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'stick', perCraftCount: 2 },
        ]),
      });
      const inv = { oak_planks: 4 }; // no sticks
      expect(stepDependenciesSatisfied(step, inv)).toBe(false);
    });

    it('returns false when ingredient count is insufficient', () => {
      const step = makeStep({
        action: 'craft',
        count: 2,
        ingredients: vg('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
        ]),
      });
      const inv = { oak_planks: 4 }; // need 8
      expect(stepDependenciesSatisfied(step, inv)).toBe(false);
    });
  });

  // ── smelt ──
  describe('smelt action', () => {
    it('returns true when input and fuel are present', () => {
      const step = makeStep({
        action: 'smelt',
        count: 1,
        input: vg('one_of', { item: 'raw_iron', perSmelt: 1 }),
        fuel: vg('one_of', 'coal'),
      });
      const inv = { raw_iron: 1, coal: 1 };
      expect(stepDependenciesSatisfied(step, inv)).toBe(true);
    });

    it('returns false when fuel is missing', () => {
      const step = makeStep({
        action: 'smelt',
        count: 1,
        input: vg('one_of', { item: 'raw_iron', perSmelt: 1 }),
        fuel: vg('one_of', 'coal'),
      });
      const inv = { raw_iron: 1 };
      expect(stepDependenciesSatisfied(step, inv)).toBe(false);
    });

    it('returns false when input is missing', () => {
      const step = makeStep({
        action: 'smelt',
        count: 1,
        input: vg('one_of', { item: 'raw_iron', perSmelt: 1 }),
        fuel: vg('one_of', 'coal'),
      });
      const inv = { coal: 1 };
      expect(stepDependenciesSatisfied(step, inv)).toBe(false);
    });
  });

  // ── mine ──
  describe('mine action', () => {
    it('returns true when required tool is present', () => {
      const step = makeStep({
        action: 'mine',
        tool: vg('one_of', 'wooden_pickaxe'),
      });
      const inv = { wooden_pickaxe: 1 };
      expect(stepDependenciesSatisfied(step, inv)).toBe(true);
    });

    it('returns false when required tool is missing', () => {
      const step = makeStep({
        action: 'mine',
        tool: vg('one_of', 'wooden_pickaxe'),
      });
      const inv = {};
      expect(stepDependenciesSatisfied(step, inv)).toBe(false);
    });

    it('returns true when no tool is required', () => {
      const step = makeStep({ action: 'mine' });
      const inv = {};
      expect(stepDependenciesSatisfied(step, inv)).toBe(true);
    });
  });

  // ── hunt ──
  describe('hunt action', () => {
    it('returns true when tool is present', () => {
      const step = makeStep({
        action: 'hunt',
        tool: vg('one_of', 'stone_sword'),
      });
      const inv = { stone_sword: 1 };
      expect(stepDependenciesSatisfied(step, inv)).toBe(true);
    });

    it('returns false when tool is missing', () => {
      const step = makeStep({
        action: 'hunt',
        tool: vg('one_of', 'stone_sword'),
      });
      const inv = {};
      expect(stepDependenciesSatisfied(step, inv)).toBe(false);
    });
  });

  // ── require ──
  describe('require action', () => {
    it('always returns true', () => {
      const step = makeStep({ action: 'require' });
      expect(stepDependenciesSatisfied(step, {})).toBe(true);
    });
  });

  // ── any_of variant mode ──
  describe('any_of variant mode', () => {
    it('returns true when any variant is satisfied', () => {
      const step = makeStep({
        action: 'craft',
        count: 1,
        ingredients: vg('any_of',
          [{ item: 'oak_planks', perCraftCount: 4 }],
          [{ item: 'spruce_planks', perCraftCount: 4 }],
        ),
      });
      const inv = { spruce_planks: 4 }; // only second variant satisfied
      expect(stepDependenciesSatisfied(step, inv)).toBe(true);
    });

    it('returns false when no variant is satisfied', () => {
      const step = makeStep({
        action: 'craft',
        count: 1,
        ingredients: vg('any_of',
          [{ item: 'oak_planks', perCraftCount: 4 }],
          [{ item: 'spruce_planks', perCraftCount: 4 }],
        ),
      });
      const inv = { birch_planks: 4 }; // neither variant
      expect(stepDependenciesSatisfied(step, inv)).toBe(false);
    });
  });
});
