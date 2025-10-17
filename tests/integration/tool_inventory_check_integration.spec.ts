import analyzeRecipes from '../../recipeAnalyzer';
import { generateTopNAndFilter } from '../../path_filters';
import { ActionStep } from '../../action_tree/types';

/**
 * Integration tests for tool inventory check fix
 * 
 * These tests verify that the entire planning system (tree building, path enumeration,
 * and optimization) correctly handles tools in inventory and does not create redundant
 * crafting steps for tools the bot already has.
 */

function countToolCrafts(path: ActionStep[], toolName: string): number {
  return path.filter(s => 
    s.action === 'craft' && 
    s.result?.variants?.[0]?.value?.item === toolName
  ).length;
}

function hasToolCraft(path: ActionStep[], toolName: string): boolean {
  return countToolCrafts(path, toolName) > 0;
}

describe('integration: tool inventory check', () => {
  const { resolveMcData } = (analyzeRecipes as any)._internals;
  resolveMcData('1.20.1');

  const baseSnapshot = {
    version: '1.20.1',
    dimension: 'overworld',
    center: { x: 0, y: 64, z: 0 },
    chunkRadius: 2,
    radius: 32,
    yMin: -64,
    yMax: 320,
    blocks: {
      oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
      birch_log: { count: 100, closestDistance: 5, averageDistance: 10 },
      stone: { count: 500, closestDistance: 2, averageDistance: 5 },
      cobblestone: { count: 500, closestDistance: 2, averageDistance: 5 },
      iron_ore: { count: 50, closestDistance: 10, averageDistance: 20 },
      deepslate_iron_ore: { count: 30, closestDistance: 15, averageDistance: 25 },
      coal_ore: { count: 60, closestDistance: 8, averageDistance: 15 },
      deepslate_coal_ore: { count: 40, closestDistance: 12, averageDistance: 20 }
    },
    entities: {}
  };

  describe('wooden_pickaxe in inventory', () => {
    test('collecting cobblestone: does NOT craft wooden_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['wooden_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        3,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // Should NOT craft wooden_pickaxe (already in inventory)
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
      expect(countToolCrafts(firstPath, 'wooden_pickaxe')).toBe(0);
    });

    test('collecting stone: does NOT craft wooden_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['wooden_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'stone',
        5,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      
      for (const path of paths.slice(0, 3)) {
        expect(hasToolCraft(path, 'wooden_pickaxe')).toBe(false);
      }
    });
  });

  describe('stone_pickaxe in inventory', () => {
    test('collecting raw_iron: does NOT craft stone_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['stone_pickaxe', 1],
        ['crafting_table', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'raw_iron',
        3,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // Should NOT craft stone_pickaxe (already in inventory)
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
      
      // Should also NOT craft prerequisite tools
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
    });

    test('mining iron_ore: does NOT craft any pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['stone_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'raw_iron',
        2,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      
      for (const path of paths) {
        expect(hasToolCraft(path, 'stone_pickaxe')).toBe(false);
        expect(hasToolCraft(path, 'wooden_pickaxe')).toBe(false);
      }
    });
  });

  describe('iron_pickaxe in inventory', () => {
    test('collecting diamonds: does NOT craft iron_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['iron_pickaxe', 1],
        ['crafting_table', 1]
      ]);
      const perGenerator = 20;
      
      const diamondSnapshot = {
        ...baseSnapshot,
        chunkRadius: 3,
        radius: 48,
        blocks: {
          ...baseSnapshot.blocks,
          diamond_ore: { count: 15, closestDistance: 30, averageDistance: 40 },
          deepslate_diamond_ore: { count: 10, closestDistance: 35, averageDistance: 45 }
        }
      };

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'diamond',
        2,
        { inventory, perGenerator, log: false, worldSnapshot: diamondSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // Should NOT craft any pickaxe
      expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
    });
  });

  describe('empty inventory (baseline)', () => {
    test('collecting cobblestone: DOES craft wooden_pickaxe', async () => {
      const inventory = new Map<string, number>();
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        3,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // SHOULD craft wooden_pickaxe when not in inventory
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(true);
    });

    test('collecting raw_iron: crafts both wooden and stone pickaxe', async () => {
      const inventory = new Map<string, number>();
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'raw_iron',
        2,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // Should craft both tool tiers
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(true);
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(true);
    });
  });

  describe('partial tool progression in inventory', () => {
    test('has wooden_pickaxe, collecting raw_iron: crafts stone_pickaxe but NOT wooden', async () => {
      const inventory = new Map<string, number>([
        ['wooden_pickaxe', 1],
        ['crafting_table', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'raw_iron',
        2,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // Should craft stone_pickaxe (needed but not in inventory)
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(true);
      
      // Should NOT craft wooden_pickaxe (already in inventory)
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
    });

    test('has stone_pickaxe, making diamond_pickaxe: crafts iron_pickaxe only', async () => {
      const inventory = new Map<string, number>([
        ['stone_pickaxe', 1],
        ['crafting_table', 1],
        ['furnace', 1],
        ['coal', 5],
        ['stick', 10]
      ]);
      const perGenerator = 20;
      
      const diamondSnapshot = {
        ...baseSnapshot,
        chunkRadius: 3,
        radius: 48,
        blocks: {
          ...baseSnapshot.blocks,
          diamond_ore: { count: 15, closestDistance: 30, averageDistance: 40 },
          deepslate_diamond_ore: { count: 10, closestDistance: 35, averageDistance: 45 }
        }
      };

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'diamond_pickaxe',
        1,
        { inventory, perGenerator, log: false, worldSnapshot: diamondSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // Should craft iron_pickaxe (needed for diamond)
      expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(true);
      
      // Should NOT craft lower tier tools (already have stone_pickaxe)
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
      
      // Should craft the target
      expect(hasToolCraft(firstPath, 'diamond_pickaxe')).toBe(true);
    });
  });

  describe('wrong tier tool in inventory', () => {
    test('has stone_pickaxe but needs iron_pickaxe for diamond: crafts iron_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['stone_pickaxe', 1],
        ['crafting_table', 1],
        ['furnace', 1],
        ['coal', 5],
        ['stick', 5]
      ]);
      const perGenerator = 20;
      
      const diamondSnapshot = {
        ...baseSnapshot,
        chunkRadius: 3,
        radius: 48,
        blocks: {
          ...baseSnapshot.blocks,
          diamond_ore: { count: 15, closestDistance: 30, averageDistance: 40 },
          deepslate_diamond_ore: { count: 10, closestDistance: 35, averageDistance: 45 }
        }
      };

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'diamond',
        2,
        { inventory, perGenerator, log: false, worldSnapshot: diamondSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      // Stone pickaxe is insufficient for diamonds, so should craft iron
      expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(true);
      
      // Should NOT re-craft the stone_pickaxe
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('multiple tools of same type in inventory: still skips crafting', async () => {
      const inventory = new Map<string, number>([
        ['wooden_pickaxe', 5]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        3,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      expect(hasToolCraft(paths[0], 'wooden_pickaxe')).toBe(false);
    });

    test('has crafting_table and wooden_pickaxe: stone_pickaxe path is shorter', async () => {
      const emptyInventory = new Map<string, number>();
      const withTools = new Map<string, number>([
        ['crafting_table', 1],
        ['wooden_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const pathsEmpty = await generateTopNAndFilter(
        '1.20.1',
        'stone_pickaxe',
        1,
        { inventory: emptyInventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      const pathsWithTools = await generateTopNAndFilter(
        '1.20.1',
        'stone_pickaxe',
        1,
        { inventory: withTools, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(pathsEmpty.length).toBeGreaterThan(0);
      expect(pathsWithTools.length).toBeGreaterThan(0);

      // Path with tools in inventory should be shorter
      expect(pathsWithTools[0].length).toBeLessThan(pathsEmpty[0].length);
    });
  });
});

