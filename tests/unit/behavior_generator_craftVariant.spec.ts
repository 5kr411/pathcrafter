import { ActionStep } from '../../action_tree/types';
import { computeTargetsForCraftVariant, canHandle } from '../../behavior_generator/craftVariant';
import { setCurrentSpeciesContext } from '../../utils/context';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';

describe('BehaviorGenerator craftVariant', () => {
  beforeEach(() => {
    // Clear species context before each test
    setCurrentSpeciesContext(null);
  });

  describe('canHandle', () => {
    it('should handle craft steps with resultVariants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('oak_planks', 4)
      });

      expect(canHandle(step)).toBe(true);
    });

    it('should handle table crafting with resultVariants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 1,
        result: createTestItemReferenceGroup('oak_door', 1)
      });

      expect(canHandle(step)).toBe(true);
    });

    it('should not handle craft steps without variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('stick', 4)
      });

      expect(canHandle(step)).toBe(false);
    });

    it('should not handle craft steps with single variant', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('oak_planks', 4)
      });

      expect(canHandle(step)).toBe(false);
    });

    it('should not handle non-craft steps', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createTestStringGroup('oak_log'),
        count: 1
      });

      expect(canHandle(step)).toBe(false);
    });
  });

  describe('computeTargetsForCraftVariant', () => {
    it('should select variant based on species context', () => {
      setCurrentSpeciesContext('oak');

      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 2,
        result: createTestItemReferenceGroup('oak_planks', 4)
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toEqual({
        itemName: 'oak_planks',
        amount: 8 // 2 * 4 perCraftCount
      });
    });

    it('should select spruce variant when species context is spruce', () => {
      setCurrentSpeciesContext('spruce');

      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 1,
        result: createTestItemReferenceGroup('oak_door', 1)
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toEqual({
        itemName: 'spruce_door',
        amount: 1
      });
    });

    it('should fallback to first variant when no species context', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 3,
        result: createTestItemReferenceGroup('oak_planks', 4)
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toEqual({
        itemName: 'oak_planks',
        amount: 12 // 3 * 4 perCraftCount
      });
    });

    it('should fallback to first variant when species context does not match', () => {
      setCurrentSpeciesContext('jungle'); // Not in variants

      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('oak_planks', 4)
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toEqual({
        itemName: 'oak_planks',
        amount: 4
      });
    });

    it('should return null when no variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 2,
        result: createTestItemReferenceGroup('stick', 4)
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toBeNull();
    });

    it('should return null for invalid steps', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 0
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toBeNull();
    });

    it('should handle missing result gracefully', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('oak_planks', 1)
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toEqual({
        itemName: 'oak_planks',
        amount: 1
      });
    });
  });
});
