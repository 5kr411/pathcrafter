/**
 * Unit tests for variant handler
 */

import { 
  groupSimilarCraftNodes, 
  groupSimilarMineNodes, 
  filterVariantsByWorldAvailability,
  fixCraftNodePrimaryFields,
  normalizePersistentRequires
} from '../../action_tree/builders';

describe('variantHandler', () => {
  describe('groupSimilarCraftNodes', () => {
    test('groups craft nodes with same ingredient shape', () => {
      const nodes = [
        {
          action: 'craft',
          operator: 'AND',
          what: 'inventory',
          count: 1,
          result: { item: 'oak_planks', perCraftCount: 4 },
          ingredients: [{ item: 'log', perCraftCount: 1 }],
          children: []
        },
        {
          action: 'craft',
          operator: 'AND',
          what: 'inventory',
          count: 1,
          result: { item: 'spruce_planks', perCraftCount: 4 },
          ingredients: [{ item: 'log', perCraftCount: 1 }],
          children: []
        }
      ] as any[];

      const grouped = groupSimilarCraftNodes({}, nodes);
      expect(grouped).toHaveLength(1);
      expect((grouped[0] as any).resultVariants).toEqual(['oak_planks', 'spruce_planks']);
      expect((grouped[0] as any).variantMode).toBe('one_of');
    });

    test('keeps craft nodes with different shapes separate', () => {
      const nodes = [
        {
          action: 'craft',
          operator: 'AND',
          what: 'inventory',
          count: 1,
          result: { item: 'oak_planks', perCraftCount: 4 },
          ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
          children: []
        },
        {
          action: 'craft',
          operator: 'AND',
          what: 'inventory',
          count: 1,
          result: { item: 'stick', perCraftCount: 4 },
          ingredients: [{ item: 'oak_planks', perCraftCount: 2 }],
          children: []
        }
      ] as any[];

      const grouped = groupSimilarCraftNodes({}, nodes);
      expect(grouped).toHaveLength(2);
    });

    test('keeps non-craft nodes unchanged', () => {
      const nodes = [
        {
          action: 'mine',
          what: 'coal_ore',
          targetItem: 'coal',
          count: 1,
          children: []
        },
        {
          action: 'craft',
          operator: 'AND',
          what: 'inventory',
          count: 1,
          result: { item: 'stick', perCraftCount: 4 },
          ingredients: [{ item: 'oak_planks', perCraftCount: 2 }],
          children: []
        }
      ] as any[];

      const grouped = groupSimilarCraftNodes({}, nodes);
      expect(grouped).toHaveLength(2);
      expect(grouped[0].action).toBe('craft');
      expect(grouped[1].action).toBe('mine');
    });
  });

  describe('groupSimilarMineNodes', () => {
    test('groups mine nodes with same tool and target suffix', () => {
      const nodes = [
        {
          action: 'mine',
          what: 'oak_log',
          targetItem: 'oak_log',
          count: 1,
          tool: 'wooden_axe',
          children: []
        },
        {
          action: 'mine',
          what: 'spruce_log',
          targetItem: 'spruce_log',
          count: 1,
          tool: 'wooden_axe',
          children: []
        }
      ] as any[];

      const grouped = groupSimilarMineNodes({}, nodes);
      expect(grouped).toHaveLength(1);
      expect((grouped[0] as any).whatVariants).toEqual(['oak_log', 'spruce_log']);
      expect((grouped[0] as any).variantMode).toBe('one_of');
    });

    test('keeps mine nodes with different tools separate', () => {
      const nodes = [
        {
          action: 'mine',
          what: 'coal_ore',
          targetItem: 'coal',
          count: 1,
          tool: 'wooden_pickaxe',
          children: []
        },
        {
          action: 'mine',
          what: 'coal_ore',
          targetItem: 'coal',
          count: 1,
          tool: 'stone_pickaxe',
          children: []
        }
      ] as any[];

      const grouped = groupSimilarMineNodes({}, nodes);
      expect(grouped).toHaveLength(2);
    });
  });

  describe('filterVariantsByWorldAvailability', () => {
    test('filters mine node variants based on world availability', () => {
      const mockWorldBudget = {
        blocks: {
          'oak_log': 10,
          'spruce_log': 0,
          'birch_log': 5
        },
        allowedBlocksWithinThreshold: new Set(['oak_log', 'birch_log'])
      };

      const node = {
        action: 'mine',
        what: 'oak_log',
        targetItem: 'oak_log',
        count: 1,
        whatVariants: ['oak_log', 'spruce_log', 'birch_log'],
        targetItemVariants: ['oak_log', 'spruce_log', 'birch_log'],
        variantMode: 'one_of',
        children: []
      } as any;

      const result = filterVariantsByWorldAvailability(node, mockWorldBudget);
      expect(result).toBe(true);
      expect(node.whatVariants).toEqual(['oak_log', 'birch_log']);
      expect(node.what).toBe('oak_log');
    });

    test('removes node when no variants are available', () => {
      const mockWorldBudget = {
        blocks: {
          'oak_log': 0,
          'spruce_log': 0
        },
        allowedBlocksWithinThreshold: new Set()
      };

      const node = {
        action: 'mine',
        what: 'oak_log',
        targetItem: 'oak_log',
        count: 1,
        whatVariants: ['oak_log', 'spruce_log'],
        targetItemVariants: ['oak_log', 'spruce_log'],
        variantMode: 'one_of',
        children: []
      } as any;

      const result = filterVariantsByWorldAvailability(node, mockWorldBudget);
      expect(result).toBe(false);
    });

    test('handles nodes without variants', () => {
      const node = {
        action: 'mine',
        what: 'coal_ore',
        targetItem: 'coal',
        count: 1,
        children: []
      } as any;

      const result = filterVariantsByWorldAvailability(node, null);
      expect(result).toBe(true);
    });
  });

  describe('fixCraftNodePrimaryFields', () => {
    test('updates craft node primary fields based on available variants', () => {
      const node = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'oak_planks', perCraftCount: 4 },
        ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
        resultVariants: ['oak_planks', 'spruce_planks'],
        ingredientVariants: [['oak_log'], ['spruce_log']],
        variantMode: 'one_of',
        children: [
          {
            action: 'mine',
            what: 'oak_log',
            targetItem: 'oak_log',
            count: 1,
            children: []
          }
        ]
      } as any;

      fixCraftNodePrimaryFields(node, null);
      expect(node.result.item).toBe('oak_planks');
      expect(node.ingredients[0].item).toBe('oak_log');
    });
  });

  describe('normalizePersistentRequires', () => {
    test('handles nodes without crashing', () => {
      const node = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'stick', perCraftCount: 4 },
        ingredients: [{ item: 'oak_planks', perCraftCount: 2 }],
        children: []
      } as any;

      expect(() => normalizePersistentRequires(node, null)).not.toThrow();
    });
  });
});
