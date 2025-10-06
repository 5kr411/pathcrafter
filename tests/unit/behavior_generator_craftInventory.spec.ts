import { ActionStep } from '../../action_tree/types';
import { computeTargetsForCraftInInventory, canHandle } from '../../behavior_generator/craftInventory';

describe('BehaviorGenerator craftInventory', () => {
  describe('canHandle', () => {
    it('should handle inventory craft steps without variants', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1,
        result: { item: 'stick', perCraftCount: 4 }
      };

      expect(canHandle(step)).toBe(true);
    });

    it('should not handle inventory craft steps with variants', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1,
        result: { item: 'oak_planks', perCraftCount: 4 },
        resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks']
      };

      expect(canHandle(step)).toBe(false);
    });

    it('should handle inventory craft steps with single variant', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1,
        result: { item: 'oak_planks', perCraftCount: 4 },
        resultVariants: ['oak_planks']
      };

      expect(canHandle(step)).toBe(true); // Single variant is same as no variants
    });

    it('should not handle table craft steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
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

  describe('computeTargetsForCraftInInventory', () => {
    it('should compute targets for simple craft step', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 2,
        result: { item: 'stick', perCraftCount: 4 }
      };

      const result = computeTargetsForCraftInInventory(step);

      expect(result).toEqual({
        itemName: 'stick',
        amount: 8 // 2 * 4 perCraftCount
      });
    });

    it('should compute targets with different perCraftCount', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 3,
        result: { item: 'planks', perCraftCount: 1 }
      };

      const result = computeTargetsForCraftInInventory(step);

      expect(result).toEqual({
        itemName: 'planks',
        amount: 3 // 3 * 1 perCraftCount
      });
    });

    it('should return null for invalid steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 0
      };

      const result = computeTargetsForCraftInInventory(step);

      expect(result).toBeNull();
    });

    it('should return null for non-inventory craft steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'table',
        count: 1,
        result: { item: 'stick', perCraftCount: 4 }
      };

      const result = computeTargetsForCraftInInventory(step);

      expect(result).toBeNull();
    });

    it('should handle missing result gracefully', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1
      };

      const result = computeTargetsForCraftInInventory(step);

      expect(result).toBeNull();
    });
  });
});
