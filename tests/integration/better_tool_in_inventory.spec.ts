import plan from '../../planner';
import { generateTopNAndFilter } from '../../path_filters';
import { ActionStep } from '../../action_tree/types';

/**
 * Integration tests for "better tool in inventory" fix
 * 
 * These tests verify that when a bot has a better tool than required,
 * the planner does not create paths that craft the lower-tier tool.
 * 
 * For example: if the bot has a diamond_pickaxe and needs to mine stone
 * (which requires wooden_pickaxe), it should NOT craft a wooden_pickaxe.
 */

function hasToolCraft(path: ActionStep[], toolName: string): boolean {
  return path.some(s => 
    s.action === 'craft' && 
    s.result?.variants?.[0]?.value?.item === toolName
  );
}

function hasAnyPickaxeCraft(path: ActionStep[]): boolean {
  const pickaxes = [
    'wooden_pickaxe',
    'stone_pickaxe', 
    'iron_pickaxe',
    'diamond_pickaxe',
    'netherite_pickaxe',
    'golden_pickaxe'
  ];
  return pickaxes.some(tool => hasToolCraft(path, tool));
}

describe('integration: better tool in inventory', () => {
  const { resolveMcData } = (plan as any)._internals;
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

  describe('diamond_pickaxe in inventory', () => {
    test('collecting cobblestone: does NOT craft wooden_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['diamond_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        5,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(false);
      expect(hasAnyPickaxeCraft(firstPath)).toBe(false);
    });

    test('collecting stone: does NOT craft any lower-tier pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['diamond_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'stone',
        10,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      
      for (const path of paths.slice(0, 3)) {
        expect(hasAnyPickaxeCraft(path)).toBe(false);
      }
    });

    test('collecting raw_iron: does NOT craft stone or wooden pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['diamond_pickaxe', 1]
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
      
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(false);
    });
  });

  describe('iron_pickaxe in inventory', () => {
    test('collecting cobblestone: does NOT craft wooden_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['iron_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        5,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      expect(hasToolCraft(paths[0], 'wooden_pickaxe')).toBe(false);
      expect(hasToolCraft(paths[0], 'stone_pickaxe')).toBe(false);
    });

    test('collecting raw_iron: does NOT craft wooden or stone pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['iron_pickaxe', 1]
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
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
    });
  });

  describe('stone_pickaxe in inventory', () => {
    test('collecting cobblestone: does NOT craft wooden_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['stone_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        5,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      expect(hasToolCraft(paths[0], 'wooden_pickaxe')).toBe(false);
    });

    test('mining stone: does NOT craft wooden_pickaxe', async () => {
      const inventory = new Map<string, number>([
        ['stone_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'stone',
        8,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      
      for (const path of paths.slice(0, 3)) {
        expect(hasToolCraft(path, 'wooden_pickaxe')).toBe(false);
      }
    });
  });

  describe('comparison: path length with better tools', () => {
    test('diamond_pickaxe path is shorter than empty inventory path', async () => {
      const emptyInventory = new Map<string, number>();
      const withDiamond = new Map<string, number>([
        ['diamond_pickaxe', 1],
        ['crafting_table', 1]
      ]);
      const perGenerator = 20;

      const pathsEmpty = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        5,
        { inventory: emptyInventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      const pathsWithDiamond = await generateTopNAndFilter(
        '1.20.1',
        'cobblestone',
        5,
        { inventory: withDiamond, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(pathsEmpty.length).toBeGreaterThan(0);
      expect(pathsWithDiamond.length).toBeGreaterThan(0);

      expect(pathsWithDiamond[0].length).toBeLessThan(pathsEmpty[0].length);
    });

    test('iron_pickaxe significantly shortens raw_iron collection', async () => {
      const emptyInventory = new Map<string, number>();
      const withIron = new Map<string, number>([
        ['iron_pickaxe', 1]
      ]);
      const perGenerator = 20;

      const pathsEmpty = await generateTopNAndFilter(
        '1.20.1',
        'raw_iron',
        3,
        { inventory: emptyInventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      const pathsWithIron = await generateTopNAndFilter(
        '1.20.1',
        'raw_iron',
        3,
        { inventory: withIron, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(pathsEmpty.length).toBeGreaterThan(0);
      expect(pathsWithIron.length).toBeGreaterThan(0);

      expect(pathsWithIron[0].length).toBeLessThan(pathsEmpty[0].length);
    });
  });

  describe('mixed tool types in inventory', () => {
    test('diamond_pickaxe does NOT prevent crafting iron_axe', async () => {
      const inventory = new Map<string, number>([
        ['diamond_pickaxe', 1],
        ['crafting_table', 1],
        ['iron_ingot', 5],
        ['stick', 10]
      ]);
      const perGenerator = 20;

      const paths = await generateTopNAndFilter(
        '1.20.1',
        'iron_axe',
        1,
        { inventory, perGenerator, log: false, worldSnapshot: baseSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);
      
      const firstPath = paths[0];
      
      expect(hasToolCraft(firstPath, 'iron_axe')).toBe(true);
      expect(hasAnyPickaxeCraft(firstPath)).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('netherite_pickaxe satisfies all lower tier requirements', async () => {
      const inventory = new Map<string, number>([
        ['netherite_pickaxe', 1]
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
      
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'diamond_pickaxe')).toBe(false);
    });

    test('golden_pickaxe satisfies wooden_pickaxe requirement', async () => {
      const inventory = new Map<string, number>([
        ['golden_pickaxe', 1]
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
  });

  describe('still crafts better tools when needed', () => {
    test('stone_pickaxe in inventory: DOES craft iron_pickaxe for diamonds', async () => {
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
        'diamond',
        2,
        { inventory, perGenerator, log: false, worldSnapshot: diamondSnapshot, pruneWithWorld: true }
      );

      expect(paths.length).toBeGreaterThan(0);

      const firstPath = paths[0];
      
      expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(true);
      
      expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
      expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
    });
  });
});

