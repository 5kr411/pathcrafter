import { ActionStep } from '../../action_tree/types';
import { computeTargetsForCraftInTable, canHandle } from '../../behavior_generator/craftTable';

describe('BehaviorGenerator craftTable', () => {
  describe('canHandle', () => {
    it('should handle table craft steps without variants', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 1,
        result: { item: 'wooden_pickaxe', perCraftCount: 1 }
      };

      expect(canHandle(step)).toBe(true);
    });

    it('should not handle table craft steps with variants', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 1,
        result: { item: 'oak_door', perCraftCount: 1 },
        resultVariants: ['oak_door', 'spruce_door', 'birch_door']
      };

      expect(canHandle(step)).toBe(false);
    });

    it('should handle table craft steps with single variant', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 1,
        result: { item: 'oak_door', perCraftCount: 1 },
        resultVariants: ['oak_door']
      };

      expect(canHandle(step)).toBe(true); // Single variant is same as no variants
    });

    it('should not handle inventory craft steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1,
        result: { item: 'stick', perCraftCount: 4 }
      };

      expect(canHandle(step)).toBe(false);
    });

    it('should not handle non-craft steps', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 1
      };

      expect(canHandle(step)).toBe(false);
    });
  });

  describe('computeTargetsForCraftInTable', () => {
    it('should compute targets for simple craft step', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 2,
        result: { item: 'wooden_pickaxe', perCraftCount: 1 }
      };

      const result = computeTargetsForCraftInTable(step);

      expect(result).toEqual({
        itemName: 'wooden_pickaxe',
        amount: 2 // 2 * 1 perCraftCount
      });
    });

    it('should compute targets with different perCraftCount', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 3,
        result: { item: 'stick', perCraftCount: 4 }
      };

      const result = computeTargetsForCraftInTable(step);

      expect(result).toEqual({
        itemName: 'stick',
        amount: 12 // 3 * 4 perCraftCount
      });
    });

    it('should return null for invalid steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 0
      };

      const result = computeTargetsForCraftInTable(step);

      expect(result).toBeNull();
    });

    it('should return null for non-table craft steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1,
        result: { item: 'stick', perCraftCount: 4 }
      };

      const result = computeTargetsForCraftInTable(step);

      expect(result).toBeNull();
    });

    it('should handle missing result gracefully', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 1
      };

      const result = computeTargetsForCraftInTable(step);

      expect(result).toBeNull();
    });
  });
});
