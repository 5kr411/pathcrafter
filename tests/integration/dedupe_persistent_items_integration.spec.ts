import analyzeRecipes from '../../recipeAnalyzer';
import { generateTopNAndFilter } from '../../path_filters';
import { ActionStep } from '../../action_tree/types';

function countPersistentItemCrafts(path: ActionStep[], itemName: string): number {
  return path.filter(s => 
    s.action === 'craft' && 
    s.result?.variants?.[0]?.value?.item === itemName
  ).length;
}

function countAllCraftingTableCrafts(path: ActionStep[]): number {
  return countPersistentItemCrafts(path, 'crafting_table');
}

function countAllToolCrafts(path: ActionStep[], toolName: string): number {
  return countPersistentItemCrafts(path, toolName);
}

describe('integration: persistent items deduplication in generated paths', () => {
  const { resolveMcData } = (analyzeRecipes as any)._internals;
  resolveMcData('1.20.1');

  test('diamond_pickaxe from scratch: deduplicates crafting_tables', async () => {
    const inventory = new Map<string, number>();
    const perGenerator = 20;
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 3,
      radius: 48,
      yMin: -64,
      yMax: 320,
      blocks: {
        spruce_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        stone: { count: 500, closestDistance: 2, averageDistance: 5 },
        cobblestone: { count: 500, closestDistance: 2, averageDistance: 5 },
        iron_ore: { count: 50, closestDistance: 10, averageDistance: 20 },
        deepslate_iron_ore: { count: 30, closestDistance: 15, averageDistance: 25 },
        coal_ore: { count: 60, closestDistance: 8, averageDistance: 15 },
        deepslate_coal_ore: { count: 40, closestDistance: 12, averageDistance: 20 },
        diamond_ore: { count: 15, closestDistance: 30, averageDistance: 40 },
        deepslate_diamond_ore: { count: 10, closestDistance: 35, averageDistance: 45 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'diamond_pickaxe',
      1,
      { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true }
    );

    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    
    // Should only have ONE crafting_table craft
    const tableCrafts = countAllCraftingTableCrafts(firstPath);
    expect(tableCrafts).toBe(1);
    
    // Should have exactly one of each pickaxe type
    expect(countAllToolCrafts(firstPath, 'wooden_pickaxe')).toBe(1);
    expect(countAllToolCrafts(firstPath, 'stone_pickaxe')).toBe(1);
    expect(countAllToolCrafts(firstPath, 'iron_pickaxe')).toBe(1);
    expect(countAllToolCrafts(firstPath, 'diamond_pickaxe')).toBe(1);
    
    // Should have exactly one furnace
    expect(countPersistentItemCrafts(firstPath, 'furnace')).toBe(1);
  });

  test('wooden_pickaxe: deduplicates crafting_table', async () => {
    const inventory = new Map<string, number>();
    const perGenerator = 30;
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 2,
      radius: 32,
      yMin: 0,
      yMax: 255,
      blocks: {
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'wooden_pickaxe',
      1,
      { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true }
    );

    expect(paths.length).toBeGreaterThan(0);

    // Check first few paths
    for (const path of paths.slice(0, 3)) {
      const tableCrafts = countAllCraftingTableCrafts(path);
      expect(tableCrafts).toBe(1);
      
      const pickaxeCrafts = countAllToolCrafts(path, 'wooden_pickaxe');
      expect(pickaxeCrafts).toBe(1);
    }
  });

  test('iron_ingot with smelting: deduplicates furnace and tools', async () => {
    const inventory = new Map<string, number>();
    const perGenerator = 25;
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 2,
      radius: 32,
      yMin: 0,
      yMax: 255,
      blocks: {
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        stone: { count: 200, closestDistance: 3, averageDistance: 8 },
        iron_ore: { count: 30, closestDistance: 15, averageDistance: 25 },
        coal_ore: { count: 40, closestDistance: 12, averageDistance: 20 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'iron_ingot',
      3,
      { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true }
    );

    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    
    // Should only have one of each persistent item
    expect(countAllCraftingTableCrafts(firstPath)).toBe(1);
    expect(countPersistentItemCrafts(firstPath, 'furnace')).toBe(1);
    expect(countAllToolCrafts(firstPath, 'wooden_pickaxe')).toBeLessThanOrEqual(1);
    expect(countAllToolCrafts(firstPath, 'stone_pickaxe')).toBeLessThanOrEqual(1);
  });

  test('stone_pickaxe: deduplicates crafting_table and wooden_pickaxe', async () => {
    const inventory = new Map<string, number>();
    const perGenerator = 25;
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 2,
      radius: 32,
      yMin: 0,
      yMax: 255,
      blocks: {
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        stone: { count: 200, closestDistance: 3, averageDistance: 8 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'stone_pickaxe',
      1,
      { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true }
    );

    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    
    expect(countAllCraftingTableCrafts(firstPath)).toBe(1);
    expect(countAllToolCrafts(firstPath, 'wooden_pickaxe')).toBe(1);
    expect(countAllToolCrafts(firstPath, 'stone_pickaxe')).toBe(1);
  });

  test('deduplication works with inventory containing persistent items', async () => {
    const inventory = new Map([
      ['crafting_table', 1],
      ['wooden_pickaxe', 1],
      ['stick', 2]
    ]);
    const perGenerator = 15;
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 2,
      radius: 32,
      yMin: 0,
      yMax: 255,
      blocks: {
        stone: { count: 200, closestDistance: 2, averageDistance: 5 },
        cobblestone: { count: 200, closestDistance: 2, averageDistance: 5 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'stone_pickaxe',
      1,
      { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true }
    );

    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    
    // Should not craft crafting_table or wooden_pickaxe since they're in inventory
    expect(countAllCraftingTableCrafts(firstPath)).toBe(0);
    expect(countAllToolCrafts(firstPath, 'wooden_pickaxe')).toBe(0);
    expect(countAllToolCrafts(firstPath, 'stone_pickaxe')).toBe(1);
  });

  test('path efficiency: diamond_pickaxe path should be significantly shorter after optimization', async () => {
    const inventory = new Map<string, number>();
    const perGenerator = 20;
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 3,
      radius: 48,
      yMin: -64,
      yMax: 320,
      blocks: {
        spruce_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        stone: { count: 500, closestDistance: 2, averageDistance: 5 },
        cobblestone: { count: 500, closestDistance: 2, averageDistance: 5 },
        iron_ore: { count: 50, closestDistance: 10, averageDistance: 20 },
        deepslate_iron_ore: { count: 30, closestDistance: 15, averageDistance: 25 },
        coal_ore: { count: 60, closestDistance: 8, averageDistance: 15 },
        deepslate_coal_ore: { count: 40, closestDistance: 12, averageDistance: 20 },
        diamond_ore: { count: 15, closestDistance: 30, averageDistance: 40 },
        deepslate_diamond_ore: { count: 10, closestDistance: 35, averageDistance: 45 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'diamond_pickaxe',
      1,
      { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true }
    );

    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    
    // After deduplication, path should be reasonable length
    // Without optimization, it would be 50-60+ steps
    // With optimization, should be ~30-40 steps
    expect(firstPath.length).toBeLessThan(45);
    expect(firstPath.length).toBeGreaterThan(25);
    
    // Count total persistent item crafts - should be exactly 6:
    // 1 crafting_table, 1 wooden_pickaxe, 1 stone_pickaxe, 1 iron_pickaxe, 1 diamond_pickaxe, 1 furnace
    const persistentCrafts = firstPath.filter(s => {
      if (s.action !== 'craft') return false;
      const item = s.result?.variants?.[0]?.value?.item;
      return item === 'crafting_table' ||
             item === 'wooden_pickaxe' ||
             item === 'stone_pickaxe' ||
             item === 'iron_pickaxe' ||
             item === 'diamond_pickaxe' ||
             item === 'furnace';
    });
    
    expect(persistentCrafts.length).toBe(6);
  });

  test('deduplication preserves non-persistent item crafts', async () => {
    const inventory = new Map<string, number>();
    const perGenerator = 20;
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 2,
      radius: 32,
      yMin: 0,
      yMax: 255,
      blocks: {
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'stick',
      8,
      { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true }
    );

    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    
    // Should craft planks multiple times (non-persistent)
    const planksCrafts = firstPath.filter(s => 
      s.action === 'craft' && 
      s.result?.variants?.[0]?.value?.item?.includes('planks')
    );
    
    // May craft planks multiple times depending on the path
    expect(planksCrafts.length).toBeGreaterThanOrEqual(1);
    
    // But should only craft crafting_table once if needed
    expect(countAllCraftingTableCrafts(firstPath)).toBeLessThanOrEqual(1);
  });
});

