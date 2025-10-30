import { buildRecipeTree } from '../../action_tree/builders';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';
import { getCachedMcData } from '../testHelpers';
import { enumerateActionPaths } from '../../action_tree/enumerate';

/**
 * Tests for wooden_pickaxe crafting from logs and sticks
 * 
 * This was a bug where the planner mutated the inventory Map parameter,
 * causing the validator to see decreasing inventory between attempts.
 */
describe('unit: wooden_pickaxe with logs and sticks in inventory', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
  });

  test('wooden_pickaxe craftable with birch_log, stick, and crafting_table in inventory', () => {
    const inventory = new Map([
      ['birch_log', 3],
      ['stick', 16],
      ['crafting_table', 5],
      ['birch_sapling', 1]
    ]);
    
    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
    
    // Tree should exist
    expect(tree).toBeDefined();
    expect(tree.action).toBe('root');
    
    // Should have at least one variant for wooden_pickaxe
    expect(tree.what?.variants?.length).toBeGreaterThan(0);
    
    // Generate paths from the tree
    const paths = Array.from(enumerateActionPaths(tree));
    
    // Should have at least one valid path
    expect(paths.length).toBeGreaterThan(0);
  });

  test('wooden_pickaxe path should convert logs to planks then craft pickaxe', () => {
    const inventory = new Map([
      ['birch_log', 3],
      ['stick', 16],
      ['crafting_table', 5]
    ]);
    
    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
    const paths = Array.from(enumerateActionPaths(tree));
    
    expect(paths.length).toBeGreaterThan(0);
    
    // Find a path that involves crafting planks and then pickaxe
    const validPath = paths.find(path => {
      const hasPlanks = path.some((step: any) => 
        step.action === 'craft' && 
        step.result?.variants?.some((v: any) => v.value?.item?.includes('planks'))
      );
      const hasPickaxe = path.some((step: any) => 
        step.action === 'craft' && 
        step.result?.variants?.some((v: any) => v.value?.item === 'wooden_pickaxe')
      );
      return hasPlanks && hasPickaxe;
    });
    
    expect(validPath).toBeDefined();
  });

  test('minimal inventory: just enough to craft wooden_pickaxe', () => {
    const inventory = new Map([
      ['oak_log', 1],
      ['stick', 2],
      ['crafting_table', 1]
    ]);
    
    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
    const paths = Array.from(enumerateActionPaths(tree));
    
    expect(paths.length).toBeGreaterThan(0);
  });

  test('only planks in inventory (no logs)', () => {
    const inventory = new Map([
      ['oak_planks', 3],
      ['stick', 2],
      ['crafting_table', 1]
    ]);
    
    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
    const paths = Array.from(enumerateActionPaths(tree));
    
    // Should have paths since we have all the exact ingredients
    expect(paths.length).toBeGreaterThan(0);
  });

  test('buildRecipeTree does not mutate inventory parameter', () => {
    const inventory = new Map([
      ['birch_log', 3],
      ['stick', 16],
      ['crafting_table', 5]
    ]);
    
    // Take a snapshot of the original inventory
    const originalInventory = new Map(inventory);
    
    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
    
    // Inventory should NOT be modified
    expect(inventory.get('birch_log')).toBe(originalInventory.get('birch_log'));
    expect(inventory.get('stick')).toBe(originalInventory.get('stick'));
    expect(inventory.get('crafting_table')).toBe(originalInventory.get('crafting_table'));
  });

  test('multiple planning calls with same inventory should all succeed', () => {
    const inventory = new Map([
      ['birch_log', 3],
      ['stick', 16],
      ['crafting_table', 5]
    ]);
    
    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    // Call buildRecipeTree multiple times with the same inventory
    // This simulates what the validator does when trying different radii
    for (let i = 0; i < 4; i++) {
      const tree = buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
      const paths = Array.from(enumerateActionPaths(tree));
      
      // Each call should succeed
      expect(paths.length).toBeGreaterThan(0);
      
      // Inventory should still have the same items
      expect(inventory.get('birch_log')).toBe(3);
      expect(inventory.get('stick')).toBe(16);
    }
  });

  test('craft-only paths are valid (no mining required)', () => {
    // This verifies we removed the diamond special-casing from the validator
    // Craft-only paths should be accepted without requiring diamonds in inventory
    const inventory = new Map([
      ['oak_planks', 3],
      ['stick', 2],
      ['crafting_table', 1]
    ]);
    
    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
    const paths = Array.from(enumerateActionPaths(tree));
    
    expect(paths.length).toBeGreaterThan(0);
    
    // All paths should be craft-only (no mining) since we have all materials
    const craftOnlyPaths = paths.filter(path => 
      path.every((step: any) => step.action === 'craft')
    );
    expect(craftOnlyPaths.length).toBeGreaterThan(0);
  });

  test('pale_oak_log inventory yields craft-only path without mining', () => {
    const mcData21 = getCachedMcData('1.21.4');
    const inventory = new Map([
      ['pale_oak_log', 1],
      ['stick', 2],
      ['crafting_table', 1]
    ]);

    const worldBudget = {
      blocks: {
        oak_planks: 10
      },
      blocksInfo: {
        oak_planks: { closestDistance: 5 }
      },
      entities: {},
      entitiesInfo: {},
      distanceThreshold: 32,
      allowedBlocksWithinThreshold: new Set(['oak_planks']),
      allowedEntitiesWithinThreshold: new Set<string>()
    };

    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true,
      pruneWithWorld: true,
      worldBudget
    };

    const tree = buildRecipeTree(mcData21, 'wooden_pickaxe', 1, context);
    const paths = Array.from(enumerateActionPaths(tree));

    expect(paths.length).toBeGreaterThan(0);

    const craftOnlyPath = paths.find(path =>
      path.every((step: any) => step.action !== 'mine') &&
      path.some((step: any) =>
        step.action === 'craft' &&
        step.result?.variants?.some((v: any) => v.value?.item === 'pale_oak_planks')
      ) &&
      path.some((step: any) =>
        step.action === 'craft' &&
        step.result?.variants?.some((v: any) => v.value?.item === 'wooden_pickaxe')
      )
    );

    expect(craftOnlyPath).toBeDefined();
  });
});

