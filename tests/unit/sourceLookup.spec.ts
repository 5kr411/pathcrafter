/**
 * Unit tests for source lookup utilities
 */

import { 
  findBlocksThatDrop, 
  findMobsThatDrop, 
  getAllSourcesForItem, 
  canObtainFromBlocks, 
  canObtainFromMobs, 
  getBestToolForBlock 
} from '../../action_tree/utils/sourceLookup';

describe('sourceLookup', () => {
  const mockMcData = {
    version: '1.19.2',
    items: {
      1: { id: 1, name: 'coal' },
      2: { id: 2, name: 'feather' },
      3: { id: 3, name: 'string' },
      4: { id: 4, name: 'wooden_pickaxe' },
      5: { id: 5, name: 'stone_pickaxe' }
    },
    itemsByName: {
      'coal': { id: 1, name: 'coal' },
      'feather': { id: 2, name: 'feather' },
      'string': { id: 3, name: 'string' }
    },
    blocks: {
      1: {
        id: 1,
        name: 'coal_ore',
        drops: [1], // drops coal
        harvestTools: {
          '4': true, // wooden_pickaxe
          '5': true  // stone_pickaxe
        }
      },
      2: {
        id: 2,
        name: 'cobweb',
        drops: [3], // drops string
        harvestTools: {} // no specific tool required
      },
      3: {
        id: 3,
        name: 'dirt',
        drops: [], // no drops
        harvestTools: {}
      }
    },
    entityLoot: {
      1: {
        entity: 'chicken',
        drops: [
          { item: 'feather', dropChance: 0.125 },
          { item: 'raw_chicken', dropChance: 1.0 }
        ]
      },
      2: {
        entity: 'spider',
        drops: [
          { item: 'string', dropChance: 0.125 },
          { item: 'spider_eye', dropChance: 0.5 }
        ]
      }
    },
    recipes: {}
  } as any;

  describe('findBlocksThatDrop', () => {
    test('finds blocks that drop coal', () => {
      const sources = findBlocksThatDrop(mockMcData, 'coal');
      expect(sources).toHaveLength(1);
      expect(sources[0].block).toBe('coal_ore');
      expect(sources[0].tool).toContain('wooden_pickaxe');
      expect(sources[0].tool).toContain('stone_pickaxe');
    });

    test('finds blocks that drop string', () => {
      const sources = findBlocksThatDrop(mockMcData, 'string');
      expect(sources).toHaveLength(1);
      expect(sources[0].block).toBe('cobweb');
      expect(sources[0].tool).toBe('any');
    });

    test('returns empty array for items not dropped by blocks', () => {
      const sources = findBlocksThatDrop(mockMcData, 'feather');
      expect(sources).toHaveLength(0);
    });

    test('returns empty array for non-existent items', () => {
      const sources = findBlocksThatDrop(mockMcData, 'nonexistent_item');
      expect(sources).toHaveLength(0);
    });
  });

  describe('findMobsThatDrop', () => {
    test('finds mobs that drop feather', () => {
      const sources = findMobsThatDrop(mockMcData, 'feather');
      expect(sources).toHaveLength(1);
      expect(sources[0].mob).toBe('chicken');
      expect(sources[0].dropChance).toBe(0.125);
    });

    test('finds mobs that drop string', () => {
      const sources = findMobsThatDrop(mockMcData, 'string');
      expect(sources).toHaveLength(1);
      expect(sources[0].mob).toBe('spider');
      expect(sources[0].dropChance).toBe(0.125);
    });

    test('returns empty array for items not dropped by mobs', () => {
      const sources = findMobsThatDrop(mockMcData, 'coal');
      expect(sources).toHaveLength(0);
    });

    test('returns empty array for non-existent items', () => {
      const sources = findMobsThatDrop(mockMcData, 'nonexistent_item');
      expect(sources).toHaveLength(0);
    });
  });

  describe('getAllSourcesForItem', () => {
    test('gets all sources for string', () => {
      const sources = getAllSourcesForItem(mockMcData, 'string');
      expect(sources.blocks).toHaveLength(1);
      expect(sources.blocks[0].block).toBe('cobweb');
      expect(sources.mobs).toHaveLength(1);
      expect(sources.mobs[0].mob).toBe('spider');
    });

    test('gets all sources for coal', () => {
      const sources = getAllSourcesForItem(mockMcData, 'coal');
      expect(sources.blocks).toHaveLength(1);
      expect(sources.blocks[0].block).toBe('coal_ore');
      expect(sources.mobs).toHaveLength(0);
    });

    test('gets all sources for feather', () => {
      const sources = getAllSourcesForItem(mockMcData, 'feather');
      expect(sources.blocks).toHaveLength(0);
      expect(sources.mobs).toHaveLength(1);
      expect(sources.mobs[0].mob).toBe('chicken');
    });
  });

  describe('canObtainFromBlocks', () => {
    test('returns true for items obtainable from blocks', () => {
      expect(canObtainFromBlocks(mockMcData, 'coal')).toBe(true);
      expect(canObtainFromBlocks(mockMcData, 'string')).toBe(true);
    });

    test('returns false for items not obtainable from blocks', () => {
      expect(canObtainFromBlocks(mockMcData, 'feather')).toBe(false);
    });

    test('returns false for non-existent items', () => {
      expect(canObtainFromBlocks(mockMcData, 'nonexistent_item')).toBe(false);
    });
  });

  describe('canObtainFromMobs', () => {
    test('returns true for items obtainable from mobs', () => {
      expect(canObtainFromMobs(mockMcData, 'feather')).toBe(true);
      expect(canObtainFromMobs(mockMcData, 'string')).toBe(true);
    });

    test('returns false for items not obtainable from mobs', () => {
      expect(canObtainFromMobs(mockMcData, 'coal')).toBe(false);
    });

    test('returns false for non-existent items', () => {
      expect(canObtainFromMobs(mockMcData, 'nonexistent_item')).toBe(false);
    });
  });

  describe('getBestToolForBlock', () => {
    test('returns specific tool for blocks requiring tools', () => {
      const tool = getBestToolForBlock(mockMcData, 'coal_ore');
      expect(tool).toBe('wooden_pickaxe');
    });

    test('returns "any" for blocks not requiring specific tools', () => {
      const tool = getBestToolForBlock(mockMcData, 'cobweb');
      expect(tool).toBe('any');
    });

    test('returns "any" for non-existent blocks', () => {
      const tool = getBestToolForBlock(mockMcData, 'nonexistent_block');
      expect(tool).toBe('any');
    });
  });
});
