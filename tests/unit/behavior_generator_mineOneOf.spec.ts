import { ActionStep } from '../../action_tree/types';
import { computeTargetsForMineOneOf, canHandle } from '../../behavior_generator/mineOneOf';
import { createTestActionStep, createTestStringGroup, createVariantGroupFromArray } from '../testHelpers';

describe('BehaviorGenerator mineOneOf', () => {
  describe('canHandle', () => {
    it('should handle mine steps with what variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createVariantGroupFromArray('one_of', ['oak_log', 'spruce_log', 'birch_log']),
        count: 5
      });

      expect(canHandle(step)).toBe(true);
    });

    it('should not handle mine steps without variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createTestStringGroup('oak_log'),
        count: 5
      });

      expect(canHandle(step)).toBe(false);
    });

    it('should not handle mine steps with single variant', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createTestStringGroup('oak_log'),
        count: 5
      });

      expect(canHandle(step)).toBe(false);
    });


    it('should not handle non-mine steps', () => {
      const step: ActionStep = createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1
      });

      expect(canHandle(step)).toBe(false);
    });
  });

  describe('computeTargetsForMineOneOf', () => {
    it('should compute targets for variant-based approach', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createVariantGroupFromArray('one_of', ['oak_log', 'spruce_log', 'birch_log']),
        count: 3
      });

      const result = computeTargetsForMineOneOf(step);

      expect(result).toEqual({
        candidates: [
          { blockName: 'oak_log', itemName: 'oak_log', amount: 3 },
          { blockName: 'spruce_log', itemName: 'spruce_log', amount: 3 },
          { blockName: 'birch_log', itemName: 'birch_log', amount: 3 }
        ],
        amount: 3
      });
    });

    it('should handle missing targetItem variants', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createVariantGroupFromArray('one_of', ['oak_log', 'spruce_log']),
        count: 2
      });

      const result = computeTargetsForMineOneOf(step);

      expect(result).toEqual({
        candidates: [
          { blockName: 'oak_log', itemName: 'oak_log', amount: 2 },
          { blockName: 'spruce_log', itemName: 'spruce_log', amount: 2 }
        ],
        amount: 2
      });
    });


    it('should return null for invalid steps', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createTestStringGroup('oak_log'),
        count: 1
      });

      const result = computeTargetsForMineOneOf(step);

      expect(result).toBeNull();
    });

    it('should handle empty candidates gracefully', () => {
      const step: ActionStep = createTestActionStep({
        action: 'mine',
        what: createVariantGroupFromArray('one_of', []),
        count: 1
      });

      const result = computeTargetsForMineOneOf(step);

      expect(result).toBeNull();
    });
  });
});
