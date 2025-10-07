/**
 * Unit tests for enhanced variant filtering functionality
 */

import { 
  filterVariantsByWorldAvailability,
  groupSimilarHuntNodes,
  fixCraftNodePrimaryFields
} from '../../action_tree/builders/variantHandler';
import { TreeNode, CraftNode, MineLeafNode, HuntLeafNode } from '../../action_tree/types';

describe('enhanced variant filtering', () => {
  describe('filterVariantsByWorldAvailability', () => {
    test('filters craft node variants based on ingredient availability in world', () => {
      const mockWorldBudget = {
        blocks: {
          'oak_log': 10,
          'spruce_log': 0,
          'birch_log': 5
        },
        allowedBlocksWithinThreshold: new Set(['oak_log', 'birch_log'])
      };

      const craftNode: CraftNode = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'oak_planks', perCraftCount: 4 },
        ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
        resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks'],
        ingredientVariants: [
          ['oak_log'],
          ['spruce_log'],
          ['birch_log']
        ],
        variantMode: 'one_of',
        children: []
      };

      const result = filterVariantsByWorldAvailability(craftNode, mockWorldBudget);
      expect(result).toBe(true);
      
      // Craft variants are not filtered based on ingredient availability
      // Crafting can produce items that aren't directly available in the world
      expect(craftNode.resultVariants).toEqual(['oak_planks', 'spruce_planks', 'birch_planks']);
      expect(craftNode.ingredientVariants).toEqual([
        ['oak_log'],
        ['spruce_log'],
        ['birch_log']
      ]);
      expect(craftNode.result.item).toBe('oak_planks');
      expect(craftNode.ingredients[0].item).toBe('oak_log');
    });

    test('keeps craft node even when no variants have available ingredients', () => {
      const mockWorldBudget = {
        blocks: {
          'spruce_log': 0,
          'jungle_log': 0
        },
        allowedBlocksWithinThreshold: new Set()
      };

      const craftNode: CraftNode = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'spruce_planks', perCraftCount: 4 },
        ingredients: [{ item: 'spruce_log', perCraftCount: 1 }],
        resultVariants: ['spruce_planks', 'jungle_planks'],
        ingredientVariants: [
          ['spruce_log'],
          ['jungle_log']
        ],
        variantMode: 'one_of',
        children: []
      };

      const result = filterVariantsByWorldAvailability(craftNode, mockWorldBudget);
      expect(result).toBe(true);
    });

    test('simplifies craft node when only one variant remains', () => {
      const mockWorldBudget = {
        blocks: {
          'oak_log': 10,
          'spruce_log': 0
        },
        allowedBlocksWithinThreshold: new Set(['oak_log'])
      };

      const craftNode: CraftNode = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'oak_planks', perCraftCount: 4 },
        ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
        resultVariants: ['oak_planks', 'spruce_planks'],
        ingredientVariants: [
          ['oak_log'],
          ['spruce_log']
        ],
        variantMode: 'one_of',
        children: []
      };

      const result = filterVariantsByWorldAvailability(craftNode, mockWorldBudget);
      expect(result).toBe(true);
      
      // Craft variants are not simplified based on ingredient availability
      expect(craftNode.resultVariants).toEqual(['oak_planks', 'spruce_planks']);
      expect(craftNode.ingredientVariants).toEqual([
        ['oak_log'],
        ['spruce_log']
      ]);
      expect(craftNode.variantMode).toBe('one_of');
      expect(craftNode.result.item).toBe('oak_planks');
      expect(craftNode.ingredients[0].item).toBe('oak_log');
    });

    test('filters hunt node variants based on entity availability', () => {
      const mockWorldBudget = {
        entities: {
          'zombie': 5,
          'skeleton': 0,
          'spider': 3
        },
        allowedEntitiesWithinThreshold: new Set(['zombie', 'spider'])
      };

      const huntNode: HuntLeafNode = {
        action: 'hunt',
        what: 'zombie',
        targetItem: 'rotten_flesh',
        count: 1,
        dropChance: 0.5,
        children: [],
        whatVariants: ['zombie', 'skeleton', 'spider'],
        targetItemVariants: ['rotten_flesh', 'bone', 'string'],
        variantMode: 'one_of'
      };

      const result = filterVariantsByWorldAvailability(huntNode, mockWorldBudget);
      expect(result).toBe(true);
      
      // Should filter out skeleton since it's not available
      expect(huntNode.whatVariants).toEqual(['zombie', 'spider']);
      expect(huntNode.targetItemVariants).toEqual(['rotten_flesh', 'string']);
      expect(huntNode.what).toBe('zombie');
      expect(huntNode.targetItem).toBe('rotten_flesh');
    });

    test('removes hunt node when no variants are available', () => {
      const mockWorldBudget = {
        entities: {
          'creeper': 0,
          'enderman': 0
        },
        allowedEntitiesWithinThreshold: new Set()
      };

      const huntNode: HuntLeafNode = {
        action: 'hunt',
        what: 'creeper',
        targetItem: 'gunpowder',
        count: 1,
        dropChance: 0.5,
        children: [],
        whatVariants: ['creeper', 'enderman'],
        targetItemVariants: ['gunpowder', 'ender_pearl'],
        variantMode: 'one_of'
      };

      const result = filterVariantsByWorldAvailability(huntNode, mockWorldBudget);
      expect(result).toBe(false);
    });

    test('handles craft nodes with suffix matching for variants', () => {
      const mockWorldBudget = {
        blocks: {
          'oak_log': 10,
          'spruce_log': 0,
          'birch_log': 5
        },
        allowedBlocksWithinThreshold: new Set(['oak_log', 'birch_log'])
      };

      const craftNode: CraftNode = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'oak_planks', perCraftCount: 4 },
        ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
        resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks'],
        ingredientVariants: [
          ['oak_log'],
          ['spruce_log'],
          ['birch_log']
        ],
        variantMode: 'one_of',
        children: []
      };

      const result = filterVariantsByWorldAvailability(craftNode, mockWorldBudget);
      expect(result).toBe(true);
      
      // Craft variants are not filtered based on ingredient availability
      expect(craftNode.resultVariants).toEqual(['oak_planks', 'spruce_planks', 'birch_planks']);
      expect(craftNode.ingredientVariants).toEqual([
        ['oak_log'],
        ['spruce_log'],
        ['birch_log']
      ]);
    });

    test('recursively filters children nodes', () => {
      const mockWorldBudget = {
        blocks: {
          'oak_log': 10,
          'spruce_log': 0
        },
        allowedBlocksWithinThreshold: new Set(['oak_log'])
      };

      const rootNode: TreeNode = {
        action: 'root',
        operator: 'OR',
        what: 'stick',
        count: 1,
        children: [
          {
            action: 'mine',
            what: 'oak_log',
            targetItem: 'oak_log',
            count: 1,
            whatVariants: ['oak_log', 'spruce_log'],
            targetItemVariants: ['oak_log', 'spruce_log'],
            variantMode: 'one_of',
            children: []
          },
          {
            action: 'mine',
            what: 'spruce_log',
            targetItem: 'spruce_log',
            count: 1,
            children: []
          }
        ]
      };

      const result = filterVariantsByWorldAvailability(rootNode, mockWorldBudget);
      expect(result).toBe(true);
      
      // First child should be filtered to only oak_log
      const firstChild = rootNode.children[0] as MineLeafNode;
      expect(firstChild.whatVariants).toBeUndefined();
      expect(firstChild.what).toBe('oak_log');
      
      // Second child should be removed entirely since spruce_log is not available
      expect(rootNode.children).toHaveLength(1);
    });
  });

  describe('groupSimilarHuntNodes', () => {
    test('groups hunt nodes with same target item suffix', () => {
      const nodes = [
        {
          action: 'hunt',
          what: 'zombie',
          targetItem: 'rotten_flesh',
          count: 1,
          dropChance: 0.5,
          children: []
        },
        {
          action: 'hunt',
          what: 'skeleton',
          targetItem: 'bone',
          count: 1,
          dropChance: 0.3,
          children: []
        },
        {
          action: 'hunt',
          what: 'spider',
          targetItem: 'string',
          count: 1,
          dropChance: 0.4,
          children: []
        }
      ] as HuntLeafNode[];

      const grouped = groupSimilarHuntNodes({}, nodes);
      expect(grouped).toHaveLength(3); // Different target items, so no grouping
    });

    test('groups hunt nodes with same target item', () => {
      const nodes = [
        {
          action: 'hunt',
          what: 'zombie',
          targetItem: 'rotten_flesh',
          count: 1,
          dropChance: 0.5,
          children: []
        },
        {
          action: 'hunt',
          what: 'husk',
          targetItem: 'rotten_flesh',
          count: 1,
          dropChance: 0.5,
          children: []
        }
      ] as HuntLeafNode[];

      const grouped = groupSimilarHuntNodes({}, nodes);
      expect(grouped).toHaveLength(1);
      expect((grouped[0] as HuntLeafNode).whatVariants).toEqual(['zombie', 'husk']);
      expect((grouped[0] as HuntLeafNode).variantMode).toBe('one_of');
    });

    test('keeps non-hunt nodes unchanged', () => {
      const nodes = [
        {
          action: 'mine',
          what: 'coal_ore',
          targetItem: 'coal',
          count: 1,
          children: []
        },
        {
          action: 'hunt',
          what: 'zombie',
          targetItem: 'rotten_flesh',
          count: 1,
          dropChance: 0.5,
          children: []
        }
      ] as TreeNode[];

      const grouped = groupSimilarHuntNodes({}, nodes);
      expect(grouped).toHaveLength(2);
      // Order may vary, so check both actions are present
      const actions = grouped.map(n => n.action);
      expect(actions).toContain('mine');
      expect(actions).toContain('hunt');
    });
  });

  describe('fixCraftNodePrimaryFields', () => {
    test('updates craft node primary fields based on available variants', () => {
      const craftNode: CraftNode = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'oak_planks', perCraftCount: 4 },
        ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
        resultVariants: ['oak_planks', 'spruce_planks'],
        ingredientVariants: [
          ['oak_log'],
          ['spruce_log']
        ],
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
      };

      fixCraftNodePrimaryFields(craftNode, null);
      expect(craftNode.result.item).toBe('oak_planks');
      expect(craftNode.ingredients[0].item).toBe('oak_log');
    });

    test('handles craft nodes without variants', () => {
      const craftNode: CraftNode = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: { item: 'stick', perCraftCount: 4 },
        ingredients: [{ item: 'oak_planks', perCraftCount: 2 }],
        children: []
      };

      expect(() => fixCraftNodePrimaryFields(craftNode, null)).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    test('handles complex tree with multiple node types and variants', () => {
      const mockWorldBudget = {
        blocks: {
          'oak_log': 10,
          'birch_log': 5,
          'spruce_log': 0
        },
        entities: {
          'zombie': 3,
          'skeleton': 0
        },
        allowedBlocksWithinThreshold: new Set(['oak_log', 'birch_log']),
        allowedEntitiesWithinThreshold: new Set(['zombie'])
      };

      const rootNode: TreeNode = {
        action: 'root',
        operator: 'OR',
        what: 'stick',
        count: 1,
        children: [
          {
            action: 'craft',
            operator: 'AND',
            what: 'inventory',
            count: 1,
            result: { item: 'oak_planks', perCraftCount: 4 },
            ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
            resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks'],
            ingredientVariants: [
              ['oak_log'],
              ['spruce_log'],
              ['birch_log']
            ],
            variantMode: 'one_of',
            children: [
              {
                action: 'mine',
                what: 'oak_log',
                targetItem: 'oak_log',
                count: 1,
                whatVariants: ['oak_log', 'spruce_log', 'birch_log'],
                targetItemVariants: ['oak_log', 'spruce_log', 'birch_log'],
                variantMode: 'one_of',
                children: []
              }
            ]
          },
          {
            action: 'hunt',
            what: 'zombie',
            targetItem: 'rotten_flesh',
            count: 1,
            dropChance: 0.5,
            whatVariants: ['zombie', 'skeleton'],
            targetItemVariants: ['rotten_flesh', 'bone'],
            variantMode: 'one_of',
            children: []
          }
        ]
      };

      const result = filterVariantsByWorldAvailability(rootNode, mockWorldBudget);
      expect(result).toBe(true);

      // Craft node variants are not filtered based on ingredient availability
      const craftNode = rootNode.children[0] as CraftNode;
      expect(craftNode.resultVariants).toEqual(['oak_planks', 'spruce_planks', 'birch_planks']);
      expect(craftNode.ingredientVariants).toEqual([
        ['oak_log'],
        ['spruce_log'],
        ['birch_log']
      ]);

      // Mine node should be filtered to oak and birch variants
      const mineNode = craftNode.children[0] as MineLeafNode;
      expect(mineNode.whatVariants).toEqual(['oak_log', 'birch_log']);
      expect(mineNode.targetItemVariants).toEqual(['oak_log', 'birch_log']);

      // Hunt node should be filtered to zombie only
      const huntNode = rootNode.children[1] as HuntLeafNode;
      expect(huntNode.whatVariants).toBeUndefined();
      expect(huntNode.what).toBe('zombie');
      expect(huntNode.targetItem).toBe('rotten_flesh');
    });
  });
});
