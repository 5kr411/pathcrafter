import { ActionStep } from '../../action_tree/types';
import { computeTargetsForCraftVariant, canHandle } from '../../behavior_generator/craftVariant';
import { setCurrentSpeciesContext } from '../../utils/context';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup, createTestItemReferenceGroupFromArray } from '../testHelpers';

describe('BehaviorGenerator craftVariant', () => {
  beforeEach(() => {
    // Clear species context before each test
    setCurrentSpeciesContext(null);
  });

  describe('canHandle', () => {
    it('should handle craft steps with result variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'spruce_planks', perCraftCount: 4 },
          { item: 'birch_planks', perCraftCount: 4 }
        ])
      });

      expect(canHandle(step)).toBe(true);
    });

    it('should handle table crafting with result variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('table'),
        count: 1,
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_door', perCraftCount: 1 },
          { item: 'spruce_door', perCraftCount: 1 },
          { item: 'birch_door', perCraftCount: 1 }
        ])
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
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'spruce_planks', perCraftCount: 4 },
          { item: 'birch_planks', perCraftCount: 4 }
        ])
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
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_door', perCraftCount: 1 },
          { item: 'spruce_door', perCraftCount: 1 },
          { item: 'birch_door', perCraftCount: 1 }
        ])
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
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'spruce_planks', perCraftCount: 4 },
          { item: 'birch_planks', perCraftCount: 4 }
        ])
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
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'spruce_planks', perCraftCount: 4 },
          { item: 'birch_planks', perCraftCount: 4 }
        ])
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
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 1 },
          { item: 'spruce_planks', perCraftCount: 1 }
        ])
      });

      const result = computeTargetsForCraftVariant(step);

      expect(result).toEqual({
        itemName: 'oak_planks',
        amount: 1
      });
    });

    it('should select variant based on inventory ingredients (most reliable)', () => {
      const mockBot: any = {
        inventory: {
          items: () => [
            { name: 'jungle_log', count: 5 }
          ]
        }
      };

      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'spruce_planks', perCraftCount: 4 },
          { item: 'jungle_planks', perCraftCount: 4 },
          { item: 'birch_planks', perCraftCount: 4 }
        ]),
        ingredients: {
          mode: 'one_of',
          variants: [
            { value: [{ item: 'oak_log', perCraftCount: 1 }] },
            { value: [{ item: 'spruce_log', perCraftCount: 1 }] },
            { value: [{ item: 'jungle_log', perCraftCount: 1 }] },
            { value: [{ item: 'birch_log', perCraftCount: 1 }] }
          ]
        }
      });

      const result = computeTargetsForCraftVariant(step, mockBot);

      expect(result).toEqual({
        itemName: 'jungle_planks',
        amount: 4
      });
    });

    it('should prefer inventory match over species context', () => {
      setCurrentSpeciesContext('oak'); // Context says oak

      const mockBot: any = {
        inventory: {
          items: () => [
            { name: 'birch_log', count: 3 } // But we have birch
          ]
        }
      };

      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'birch_planks', perCraftCount: 4 }
        ]),
        ingredients: {
          mode: 'one_of',
          variants: [
            { value: [{ item: 'oak_log', perCraftCount: 1 }] },
            { value: [{ item: 'birch_log', perCraftCount: 1 }] }
          ]
        }
      });

      const result = computeTargetsForCraftVariant(step, mockBot);

      // Should pick birch (inventory match) not oak (species context)
      expect(result).toEqual({
        itemName: 'birch_planks',
        amount: 4
      });
    });

    it('should fallback to species context when inventory has no matching ingredients', () => {
      setCurrentSpeciesContext('spruce');

      const mockBot: any = {
        inventory: {
          items: () => [
            { name: 'dirt', count: 10 } // Unrelated item
          ]
        }
      };

      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroupFromArray('one_of', [
          { item: 'oak_planks', perCraftCount: 4 },
          { item: 'spruce_planks', perCraftCount: 4 }
        ]),
        ingredients: {
          mode: 'one_of',
          variants: [
            { value: [{ item: 'oak_log', perCraftCount: 1 }] },
            { value: [{ item: 'spruce_log', perCraftCount: 1 }] }
          ]
        }
      });

      const result = computeTargetsForCraftVariant(step, mockBot);

      // Should use species context since inventory doesn't match
      expect(result).toEqual({
        itemName: 'spruce_planks',
        amount: 4
      });
    });
  });
});
