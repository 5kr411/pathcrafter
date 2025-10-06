import { ActionStep } from '../../action_tree/types';
import { computeTargetsForMine, canHandle } from '../../behavior_generator/mine';

describe('BehaviorGenerator mine', () => {
  describe('canHandle', () => {
    it('should handle mine steps without variants', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5
      };

      expect(canHandle(step)).toBe(true);
    });

    it('should not handle mine steps with variants', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5,
        whatVariants: ['oak_log', 'spruce_log', 'birch_log']
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

      expect(canHandle(step)).toBe(true); // Single variant is same as no variants
    });

    it('should not handle non-mine steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1
      };

      expect(canHandle(step)).toBe(false);
    });

    it('should not handle mine steps with operator and children', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5,
        operator: 'OR',
        children: [{ action: 'mine', what: 'spruce_log', count: 5 }]
      } as any;

      expect(canHandle(step)).toBe(false);
    });
  });

  describe('computeTargetsForMine', () => {
    it('should compute targets for simple mine step', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 3
      };

      const result = computeTargetsForMine(step);

      expect(result).toEqual({
        itemName: 'oak_log',
        amount: 3,
        blockName: 'oak_log'
      });
    });

    it('should compute targets with targetItem', () => {
      const step: ActionStep = {
        action: 'mine',
        what: 'oak_log',
        count: 5,
        targetItem: 'wood'
      };

      const result = computeTargetsForMine(step);

      expect(result).toEqual({
        itemName: 'wood',
        amount: 5,
        blockName: 'oak_log'
      });
    });

    it('should return null for invalid steps', () => {
      const step: ActionStep = {
        action: 'mine',
        what: '',
        count: 1
      };

      const result = computeTargetsForMine(step);

      expect(result).toBeNull();
    });

    it('should return null for non-mine steps', () => {
      const step: ActionStep = {
        action: 'craft',
        what: 'inventory',
        count: 1
      };

      const result = computeTargetsForMine(step);

      expect(result).toBeNull();
    });
  });
});