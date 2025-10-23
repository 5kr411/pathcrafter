import plan from '../../planner';
import { generateTopNAndFilter } from '../../path_filters';
import { ActionStep } from '../../action_tree/types';

/**
 * Failing test case: diamond_pickaxe planning failure
 * 
 * Reproduces the exact scenario from the logs where the bot has:
 * - iron_pickaxe in inventory (can mine diamond ore)
 * - diamond_ore available in world (8 count)
 * - deepslate_diamond_ore available in world (24 count)
 * - crafting_table, sticks, etc.
 * 
 * BUT the planner builds a tree with 0 root variants and generates no paths.
 * 
 * This test uses both pruneWithWorld=true and combineSimilarNodes=true
 * to test the interaction between these features.
 */

function hasToolCraft(path: ActionStep[], toolName: string): boolean {
  return path.some(s => 
    s.action === 'craft' && 
    s.result?.variants?.[0]?.value?.item === toolName
  );
}

describe('integration: diamond_pickaxe planning failure', () => {
  const { resolveMcData } = (plan as any)._internals;
  resolveMcData('1.20.1');

  test('should generate plan for diamond_pickaxe with iron_pickaxe in inventory', async () => {
    // Exact inventory from the logs
    const inventory = new Map<string, number>([
      ['oak_planks', 41],
      ['iron_pickaxe', 1],
      ['oak_log', 1],
      ['andesite', 1],
      ['coal', 1],
      ['furnace', 1],
      ['oak_sapling', 6],
      ['wooden_pickaxe', 1],
      ['dirt', 17],
      ['stone_pickaxe', 1],
      ['cobblestone', 49],
      ['crafting_table', 1],
      ['granite', 21]
    ]);

    // World snapshot with diamond ore available (from logs)
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 4,
      radius: 128,
      yMin: -64,
      yMax: 320,
      blocks: {
        // Diamond ores (as reported in logs)
        diamond_ore: { count: 8, closestDistance: 80.6, averageDistance: 90 },
        deepslate_diamond_ore: { count: 24, closestDistance: 81.9, averageDistance: 95 },
        
        // Other common blocks
        oak_log: { count: 200, closestDistance: 5, averageDistance: 15 },
        stone: { count: 1000, closestDistance: 2, averageDistance: 10 },
        cobblestone: { count: 500, closestDistance: 2, averageDistance: 8 },
        iron_ore: { count: 50, closestDistance: 20, averageDistance: 30 },
        deepslate_iron_ore: { count: 80, closestDistance: 25, averageDistance: 40 },
        coal_ore: { count: 100, closestDistance: 10, averageDistance: 20 }
      },
      entities: {}
    };

    // First, test just the tree building to see if it has variants
    const tree = plan(
      '1.20.1',
      'diamond_pickaxe',
      1,
      {
        inventory,
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true,
        log: false
      }
    );

    // The tree should have at least one child variant (a way to obtain diamond_pickaxe)
    expect(tree.children.variants.length).toBeGreaterThan(0);

    // Now test path generation
    const paths = await generateTopNAndFilter(
      '1.20.1',
      'diamond_pickaxe',
      1,
      { 
        inventory, 
        perGenerator: 20, 
        log: false, 
        worldSnapshot, 
        pruneWithWorld: true 
      }
    );

    // Should generate at least one valid path
    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    
    // The path should craft diamond_pickaxe
    expect(hasToolCraft(firstPath, 'diamond_pickaxe')).toBe(true);
    
    // Should NOT craft iron_pickaxe (already have it)
    expect(hasToolCraft(firstPath, 'iron_pickaxe')).toBe(false);
    
    // Should NOT craft lower tier pickaxes (already have better)
    expect(hasToolCraft(firstPath, 'stone_pickaxe')).toBe(false);
    expect(hasToolCraft(firstPath, 'wooden_pickaxe')).toBe(false);
  });

  test('should generate plan for diamond_pickaxe with minimal inventory', async () => {
    // Minimal test case: just iron_pickaxe, crafting_table, and sticks
    const inventory = new Map<string, number>([
      ['iron_pickaxe', 1],
      ['crafting_table', 1],
      ['stick', 10]
    ]);

    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 3,
      radius: 48,
      yMin: -64,
      yMax: 320,
      blocks: {
        diamond_ore: { count: 10, closestDistance: 30, averageDistance: 40 },
        deepslate_diamond_ore: { count: 15, closestDistance: 35, averageDistance: 45 }
      },
      entities: {}
    };

    const tree = plan(
      '1.20.1',
      'diamond_pickaxe',
      1,
      {
        inventory,
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true,
        log: false
      }
    );

    // The tree should have at least one child variant
    expect(tree.children.variants.length).toBeGreaterThan(0);

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'diamond_pickaxe',
      1,
      { 
        inventory, 
        perGenerator: 20, 
        log: false, 
        worldSnapshot, 
        pruneWithWorld: true 
      }
    );

    expect(paths.length).toBeGreaterThan(0);
  });
});

