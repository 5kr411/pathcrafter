/**
 * Unit tests for tree orchestrator
 */

import { buildRecipeTree } from '../../action_tree/builders';

describe('treeOrchestrator', () => {
  describe('buildRecipeTree', () => {
    test('builds recipe tree for simple item', () => {
      const mockMcData = {
        version: '1.20.1',
        itemsByName: {
          'stick': { id: 280, name: 'stick' },
          'oak_planks': { id: 5, name: 'oak_planks' }
        },
        items: {
          280: { name: 'stick' },
          5: { name: 'oak_planks' }
        },
        recipes: {
          280: [{
            ingredients: [5],
            result: { id: 280, count: 4 }
          }]
        }
      };

      const tree = buildRecipeTree(mockMcData, 'stick', 1, {});
      
      expect(tree.action).toBe('root');
      expect(tree.what).toBe('stick');
      expect(tree.count).toBe(1);
      expect(tree.children).toBeDefined();
    });

    test('handles null mcData gracefully', () => {
      expect(() => {
        buildRecipeTree(null, 'stick', 1, {});
      }).toThrow('Could not resolve Minecraft data');
    });

    test('returns simple root when target count is 0', () => {
      const mockMcData = {
        version: '1.20.1',
        itemsByName: {
          'stick': { id: 280, name: 'stick' }
        },
        items: {
          280: { name: 'stick' }
        },
        recipes: {}
      };

      const context = {
        inventory: { 'stick': 5 }
      };

      const tree = buildRecipeTree(mockMcData, 'stick', 1, context);
      
      expect(tree.action).toBe('root');
      expect(tree.what).toBe('stick');
      expect(tree.count).toBe(0);
      expect(tree.children).toHaveLength(0);
    });

    test('handles empty item group', () => {
      const mockMcData = {
        version: '1.20.1',
        itemsByName: {},
        items: {},
        recipes: {}
      };

      const tree = buildRecipeTree(mockMcData, 'nonexistent_item', 1, {});
      
      expect(tree.action).toBe('root');
      expect(tree.what).toBe('nonexistent_item');
      expect(tree.count).toBe(1);
    });

    test('processes similar items when combineSimilarNodes is enabled', () => {
      const mockMcData = {
        version: '1.20.1',
        itemsByName: {
          'oak_planks': { id: 5, name: 'oak_planks' },
          'spruce_planks': { id: 6, name: 'spruce_planks' }
        },
        items: {
          5: { name: 'oak_planks' },
          6: { name: 'spruce_planks' }
        },
        recipes: {
          5: [{
            ingredients: [1],
            result: { id: 5, count: 4 }
          }],
          6: [{
            ingredients: [2],
            result: { id: 6, count: 4 }
          }]
        }
      };

      const context = {
        combineSimilarNodes: true
      };

      const tree = buildRecipeTree(mockMcData, 'oak_planks', 1, context);
      
      expect(tree.action).toBe('root');
      expect(tree.what).toBe('oak_planks');
      expect(tree.count).toBe(1);
    });
  });
});
