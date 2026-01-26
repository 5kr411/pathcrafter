/**
 * Unit tests for source lookup utilities
 */

import { 
  findBlocksThatDrop, 
  findMobsThatDrop, 
  getAllSourcesForItem, 
  canObtainFromBlocks, 
  canObtainFromMobs, 
  getBestToolForBlock,
  getExpectedBlocksForItem,
  SECONDARY_BLOCK_DROPS
} from '../../action_tree/utils/sourceLookup';
import { determineTargetItemsFromBlocks } from '../../action_tree/builders/variantResolver';

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

  describe('findBlocksThatDrop - secondary block drops', () => {
    const realMcData = require('minecraft-data')('1.20.1');

    test('finds sweet_berry_bush for sweet_berries', () => {
      const sources = findBlocksThatDrop(realMcData, 'sweet_berries');
      expect(sources).toHaveLength(1);
      expect(sources[0].block).toBe('sweet_berry_bush');
      expect(sources[0].tool).toBe('any');
    });

    test('finds cave_vines blocks for glow_berries', () => {
      const sources = findBlocksThatDrop(realMcData, 'glow_berries');
      expect(sources).toHaveLength(2);
      expect(sources.map(s => s.block)).toContain('cave_vines');
      expect(sources.map(s => s.block)).toContain('cave_vines_plant');
      expect(sources.every(s => s.tool === 'any')).toBe(true);
    });

    test('finds gravel for flint (probabilistic drop)', () => {
      const sources = findBlocksThatDrop(realMcData, 'flint');
      expect(sources).toHaveLength(1);
      expect(sources[0].block).toBe('gravel');
      expect(sources[0].tool).toBe('any');
    });

    test('finds grass for wheat_seeds (probabilistic drop)', () => {
      const sources = findBlocksThatDrop(realMcData, 'wheat_seeds');
      // Includes grass from secondary drops and wheat from minecraft-data
      expect(sources.map(s => s.block)).toContain('grass');
      expect(sources.map(s => s.block)).toContain('wheat');
    });
  });

  describe('getExpectedBlocksForItem', () => {
    test('calculates expected blocks for probabilistic drops', () => {
      // Flint has 10% drop rate, so need ~10 gravel per flint
      const blocksFor10Flint = getExpectedBlocksForItem('flint', 10);
      expect(blocksFor10Flint).toBe(100);
    });

    test('calculates expected blocks for guaranteed drops with multiple drops per block', () => {
      // Sweet berries average 2.5 per bush
      const blocksFor10Berries = getExpectedBlocksForItem('sweet_berries', 10);
      expect(blocksFor10Berries).toBe(4); // ceil(10 / 2.5) = 4
    });

    test('returns null for items not in secondary drops', () => {
      const result = getExpectedBlocksForItem('diamond', 5);
      expect(result).toBeNull();
    });
  });

  describe('SECONDARY_BLOCK_DROPS configuration', () => {
    test('has required fields for all entries', () => {
      for (const [_itemName, drops] of Object.entries(SECONDARY_BLOCK_DROPS)) {
        expect(drops.length).toBeGreaterThan(0);
        for (const drop of drops) {
          expect(drop.block).toBeDefined();
          expect(drop.tool).toBeDefined();
          expect(typeof drop.dropChance).toBe('number');
          expect(drop.dropChance).toBeGreaterThan(0);
          expect(drop.dropChance).toBeLessThanOrEqual(1);
          expect(typeof drop.avgDropsPerBlock).toBe('number');
          expect(drop.avgDropsPerBlock).toBeGreaterThan(0);
          expect(drop.reason).toBeDefined();
        }
      }
    });

    test('flint config has correct drop chance', () => {
      const flintDrops = SECONDARY_BLOCK_DROPS['flint'];
      expect(flintDrops).toBeDefined();
      expect(flintDrops[0].dropChance).toBe(0.1);
    });

    test('sweet_berries config has higher drop rate', () => {
      const berryDrops = SECONDARY_BLOCK_DROPS['sweet_berries'];
      expect(berryDrops).toBeDefined();
      expect(berryDrops[0].dropChance).toBe(1.0);
      expect(berryDrops[0].avgDropsPerBlock).toBe(2.5);
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

describe('determineTargetItemsFromBlocks - secondary block drops', () => {
  const realMcData = require('minecraft-data')('1.20.1');

  test('maps sweet_berry_bush to sweet_berries', () => {
    const targets = determineTargetItemsFromBlocks(
      realMcData,
      ['sweet_berry_bush'],
      ['sweet_berries']
    );
    expect(targets).toContain('sweet_berries');
  });

  test('maps cave_vines to glow_berries', () => {
    const targets = determineTargetItemsFromBlocks(
      realMcData,
      ['cave_vines'],
      ['glow_berries']
    );
    expect(targets).toContain('glow_berries');
  });

  test('maps cave_vines_plant to glow_berries', () => {
    const targets = determineTargetItemsFromBlocks(
      realMcData,
      ['cave_vines_plant'],
      ['glow_berries']
    );
    expect(targets).toContain('glow_berries');
  });

  test('maps gravel to flint', () => {
    const targets = determineTargetItemsFromBlocks(
      realMcData,
      ['gravel'],
      ['flint']
    );
    expect(targets).toContain('flint');
  });

  test('still works for regular blocks like melon', () => {
    const targets = determineTargetItemsFromBlocks(
      realMcData,
      ['melon'],
      ['melon_slice']
    );
    expect(targets).toContain('melon_slice');
  });
});

describe('planner integration - secondary block drops', () => {
  const realMcData = require('minecraft-data')('1.20.1');
  const { plan } = require('../../planner');

  test('creates valid path for flint from gravel', () => {
    const tree = plan(realMcData, 'flint', 5, {
      inventory: new Map(),
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(tree).toBeDefined();
    expect(tree.children?.variants?.length).toBeGreaterThan(0);
    
    const mineGroup = tree.children.variants[0].value;
    expect(mineGroup.action).toBe('mine');
    
    // The leaf node should have gravel as the block to mine
    const mineLeaf = mineGroup.children?.variants?.[0]?.value;
    expect(mineLeaf?.what?.variants?.[0]?.value).toBe('gravel');
    expect(mineLeaf?.targetItem?.variants?.[0]?.value).toBe('flint');
  });

  test('creates valid path for sweet_berries from bush', () => {
    const tree = plan(realMcData, 'sweet_berries', 5, {
      inventory: new Map(),
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(tree).toBeDefined();
    expect(tree.children?.variants?.length).toBeGreaterThan(0);
    
    const mineGroup = tree.children.variants[0].value;
    expect(mineGroup.action).toBe('mine');
    
    const mineLeaf = mineGroup.children?.variants?.[0]?.value;
    expect(mineLeaf?.what?.variants?.[0]?.value).toBe('sweet_berry_bush');
    expect(mineLeaf?.targetItem?.variants?.[0]?.value).toBe('sweet_berries');
  });
});
