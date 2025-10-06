/**
 * Unit tests for item similarity utilities
 */

import { 
  findSimilarItems, 
  areItemsSimilar, 
  getItemSuffix, 
  isCombinableSuffix 
} from '../../action_tree/utils/itemSimilarity';

describe('itemSimilarity', () => {
  const mockMcData = {
    version: '1.19.2',
    items: {
      1: { id: 1, name: 'oak_planks' },
      2: { id: 2, name: 'spruce_planks' },
      3: { id: 3, name: 'birch_planks' },
      4: { id: 4, name: 'oak_log' },
      5: { id: 5, name: 'spruce_log' },
      6: { id: 6, name: 'iron_ingot' },
      7: { id: 7, name: 'gold_ingot' },
      8: { id: 8, name: 'oak_door' },
      9: { id: 9, name: 'spruce_door' },
      10: { id: 10, name: 'iron_door' }
    },
    itemsByName: {
      'oak_planks': { id: 1, name: 'oak_planks' },
      'spruce_planks': { id: 2, name: 'spruce_planks' },
      'birch_planks': { id: 3, name: 'birch_planks' },
      'oak_log': { id: 4, name: 'oak_log' },
      'spruce_log': { id: 5, name: 'spruce_log' },
      'iron_ingot': { id: 6, name: 'iron_ingot' },
      'gold_ingot': { id: 7, name: 'gold_ingot' },
      'oak_door': { id: 8, name: 'oak_door' },
      'spruce_door': { id: 9, name: 'spruce_door' },
      'iron_door': { id: 10, name: 'iron_door' }
    },
    recipes: {},
    blocks: {},
    entityLoot: {}
  } as any;

  describe('findSimilarItems', () => {
    test('finds similar wood planks', () => {
      const similar = findSimilarItems(mockMcData, 'oak_planks');
      expect(similar).toContain('oak_planks');
      expect(similar).toContain('spruce_planks');
      expect(similar).toContain('birch_planks');
      expect(similar.length).toBeGreaterThan(1);
    });

    test('finds similar wood logs', () => {
      const similar = findSimilarItems(mockMcData, 'oak_log');
      expect(similar).toContain('oak_log');
      expect(similar).toContain('spruce_log');
      expect(similar.length).toBeGreaterThan(1);
    });

    test('does not find similar ingots (not combinable)', () => {
      const similar = findSimilarItems(mockMcData, 'iron_ingot');
      expect(similar).toEqual(['iron_ingot']);
    });

    test('does not find similar gold ingots (not combinable)', () => {
      const similar = findSimilarItems(mockMcData, 'gold_ingot');
      expect(similar).toEqual(['gold_ingot']);
    });

    test('finds similar doors', () => {
      const similar = findSimilarItems(mockMcData, 'oak_door');
      expect(similar).toContain('oak_door');
      expect(similar).toContain('spruce_door');
      expect(similar.length).toBeGreaterThan(1);
    });

    test('returns single item when no similar items found', () => {
      const similar = findSimilarItems(mockMcData, 'iron_ingot');
      expect(similar).toEqual(['iron_ingot']);
    });

    test('handles items with no underscore', () => {
      const similar = findSimilarItems(mockMcData, 'dirt');
      expect(similar).toEqual(['dirt']);
    });

    test('only includes items with same number of parts', () => {
      // This test ensures that oak_planks (2 parts) doesn't match oak_wood_planks (3 parts)
      const similar = findSimilarItems(mockMcData, 'oak_planks');
      similar.forEach(item => {
        expect(item.split('_').length).toBe(2);
      });
    });
  });

  describe('areItemsSimilar', () => {
    test('returns true for similar wood planks', () => {
      expect(areItemsSimilar(mockMcData, 'oak_planks', 'spruce_planks')).toBe(true);
      expect(areItemsSimilar(mockMcData, 'spruce_planks', 'birch_planks')).toBe(true);
    });

    test('returns true for similar wood logs', () => {
      expect(areItemsSimilar(mockMcData, 'oak_log', 'spruce_log')).toBe(true);
    });

    test('returns false for different ingots', () => {
      expect(areItemsSimilar(mockMcData, 'iron_ingot', 'gold_ingot')).toBe(false);
    });

    test('returns false for different item types', () => {
      expect(areItemsSimilar(mockMcData, 'oak_planks', 'iron_ingot')).toBe(false);
      expect(areItemsSimilar(mockMcData, 'oak_log', 'oak_planks')).toBe(false);
    });

    test('returns true for identical items', () => {
      expect(areItemsSimilar(mockMcData, 'oak_planks', 'oak_planks')).toBe(true);
    });
  });

  describe('getItemSuffix', () => {
    test('extracts suffix from item names', () => {
      expect(getItemSuffix('oak_planks')).toBe('planks');
      expect(getItemSuffix('spruce_log')).toBe('log');
      expect(getItemSuffix('iron_ingot')).toBe('ingot');
      expect(getItemSuffix('oak_door')).toBe('door');
    });

    test('returns full name for items with no underscore', () => {
      expect(getItemSuffix('dirt')).toBe('dirt');
      expect(getItemSuffix('stone')).toBe('stone');
    });

    test('handles single word items', () => {
      expect(getItemSuffix('wood')).toBe('wood');
      expect(getItemSuffix('log')).toBe('log');
    });
  });

  describe('isCombinableSuffix', () => {
    test('returns true for combinable suffixes', () => {
      expect(isCombinableSuffix('planks')).toBe(true);
      expect(isCombinableSuffix('log')).toBe(true);
      expect(isCombinableSuffix('door')).toBe(true);
      expect(isCombinableSuffix('stairs')).toBe(true);
      expect(isCombinableSuffix('slab')).toBe(true);
    });

    test('returns false for non-combinable suffixes', () => {
      expect(isCombinableSuffix('ingot')).toBe(false);
      expect(isCombinableSuffix('ore')).toBe(false);
      expect(isCombinableSuffix('block')).toBe(false);
      expect(isCombinableSuffix('dust')).toBe(false);
    });

    test('handles edge cases', () => {
      expect(isCombinableSuffix('')).toBe(false);
      expect(isCombinableSuffix('unknown')).toBe(false);
    });
  });
});
