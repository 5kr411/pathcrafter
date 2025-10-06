import { ActionStep } from '../../action_tree/types';
import { computeTargetsForMineOneOf, canHandle } from '../../behavior_generator/mineOneOf';

describe('BehaviorGenerator mineOneOf', () => {
  describe('canHandle', () => {
    it('should handle mine steps with whatVariants', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5,
        whatVariants: ['oak_log', 'spruce_log', 'birch_log'],
        targetItemVariants: ['oak_log', 'spruce_log', 'birch_log']
      };

      expect(canHandle(step)).toBe(true);
    });

    it('should not handle mine steps without variants', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5
      };

      expect(canHandle(step)).toBe(false);
    });

    it('should not handle mine steps with single variant', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5,
        whatVariants: ['oak_log']
      };

      expect(canHandle(step)).toBe(false);
    });

    it('should handle legacy meta-based approach', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5,
        meta: {
          oneOfCandidates: [
            { blockName: 'oak_log' },
            { blockName: 'spruce_log' }
          ]
        }
      } as any;

      expect(canHandle(step)).toBe(true);
    });

    it('should not handle non-mine steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1
      };

      expect(canHandle(step)).toBe(false);
    });
  });

  describe('computeTargetsForMineOneOf', () => {
    it('should compute targets for variant-based approach', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 3,
        whatVariants: ['oak_log', 'spruce_log', 'birch_log'],
        targetItemVariants: ['oak_log', 'spruce_log', 'birch_log']
      };

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

    it('should handle missing targetItemVariants', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 2,
        whatVariants: ['oak_log', 'spruce_log']
      };

      const result = computeTargetsForMineOneOf(step);

      expect(result).toEqual({
        candidates: [
          { blockName: 'oak_log', itemName: 'oak_log', amount: 2 },
          { blockName: 'spruce_log', itemName: 'spruce_log', amount: 2 }
        ],
        amount: 2
      });
    });

    it('should compute targets for legacy meta-based approach', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 4,
        targetItem: 'wood',
        meta: {
          oneOfCandidates: [
            { blockName: 'oak_log' },
            { blockName: 'spruce_log' },
            { blockName: 'birch_log' }
          ]
        }
      } as any;

      const result = computeTargetsForMineOneOf(step);

      expect(result).toEqual({
        candidates: [
          { blockName: 'oak_log', itemName: 'wood', amount: 4 },
          { blockName: 'spruce_log', itemName: 'wood', amount: 4 },
          { blockName: 'birch_log', itemName: 'wood', amount: 4 }
        ],
        amount: 4
      });
    });

    it('should return null for invalid steps', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 1
      };

      const result = computeTargetsForMineOneOf(step);

      expect(result).toBeNull();
    });

    it('should handle empty candidates gracefully', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 1,
        meta: {
          oneOfCandidates: []
        }
      } as any;

      const result = computeTargetsForMineOneOf(step);

      expect(result).toBeNull();
    });
  });
});
