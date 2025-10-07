import { ActionStep } from '../../action_tree/types';
import { computeTargetsForCraftInTable, canHandle } from '../../behavior_generator/craftTable';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';

describe('BehaviorGenerator craftTable', () => {
  describe('canHandle', () => {
    it('should handle table craft steps without variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 1,
        result: createTestItemReferenceGroup('wooden_pickaxe', 1)
      });

      expect(canHandle(step)).toBe(true);
    });

    it('should handle table craft steps with single variant', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 1,
        result: createTestItemReferenceGroup('oak_door', 1)
      });

      expect(canHandle(step)).toBe(true); // Single variant is same as no variants
    });

    it('should not handle inventory craft steps', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('stick', 4)
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

  describe('computeTargetsForCraftInTable', () => {
    it('should compute targets for simple craft step', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 2,
        result: createTestItemReferenceGroup('wooden_pickaxe', 1)
      });

      const result = computeTargetsForCraftInTable(step);

      expect(result).toEqual({
        itemName: 'wooden_pickaxe',
        amount: 2 // 2 * 1 perCraftCount
      });
    });

    it('should compute targets with different perCraftCount', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 3,
        result: createTestItemReferenceGroup('stick', 4)
      });

      const result = computeTargetsForCraftInTable(step);

      expect(result).toEqual({
        itemName: 'stick',
        amount: 12 // 3 * 4 perCraftCount
      });
    });

    it('should return null for invalid steps', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 0
      });

      const result = computeTargetsForCraftInTable(step);

      expect(result).toBeNull();
    });

    it('should return null for non-table craft steps', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('stick', 4)
      });

      const result = computeTargetsForCraftInTable(step);

      expect(result).toBeNull();
    });

    it('should handle missing result gracefully', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 1
      });

      const result = computeTargetsForCraftInTable(step);

      expect(result).toBeNull();
    });
  });
});
