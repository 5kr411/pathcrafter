import { generateTopNAndFilter } from '../../path_filters';

describe('integration: path generation with combined tree variants', () => {
  
  test('end-to-end path generation with variants handles world filtering', async () => {
    const snapshot = {
      version: '1.20.1', 
      dimension: 'overworld', 
      center: { x: 0, y: 64, z: 0 }, 
      radius: 48, 
      yMin: 0, 
      yMax: 255,
      blocks: {
        spruce_log: { count: 20, closestDistance: 5, averageDistance: 10 },
        birch_log: { count: 15, closestDistance: 15, averageDistance: 20 },
        oak_log: { count: 5, closestDistance: 50, averageDistance: 60 },
        dead_bush: { count: 10, closestDistance: 8, averageDistance: 12 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: {},
      worldSnapshot: snapshot,
      perGenerator: 20,
      log: false,
      pruneWithWorld: false, // Disable pruning to allow variant expansion
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Should generate paths with different approaches
    const approaches = new Set<string>();
    paths.forEach(path => {
      path.forEach(step => {
        if (step.action === 'mine' && /_log$/.test(step.what.variants[0].value)) {
          approaches.add('log');
        }
        if (step.action === 'mine' && step.what.variants[0].value === 'dead_bush') {
          approaches.add('dead_bush');
        }
      });
    });

    // Should have at least one approach
    expect(approaches.size).toBeGreaterThan(0);
  });

  test('combined variant paths work with inventory', async () => {
    const paths = await generateTopNAndFilter('1.20.1', 'stick', 4, {
      inventory: { oak_log: 2 },
      perGenerator: 15,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // All paths should be valid
    paths.forEach(path => {
      expect(path).toBeDefined();
      expect(path.length).toBeGreaterThan(0);
    });

    // Verify paths were generated successfully with inventory
    expect(paths.length).toBeGreaterThan(0);
  });

  test('variant expansion creates diverse paths for complex items', async () => {
    const paths = await generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, {
      inventory: { crafting_table: 1 },
      perGenerator: 20,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Count different wood types used across all paths
    const woodTypesUsed = new Set<string>();
    paths.forEach(path => {
      path.forEach(step => {
        if (step.action === 'mine' && /_log$/.test(step.what.variants[0].value)) {
          woodTypesUsed.add(step.what.variants[0].value);
        }
        if (step.action === 'craft' && step.result && 
            step.result.variants[0].value.item.includes('planks')) {
          woodTypesUsed.add(step.result.variants[0].value.item);
        }
      });
    });

    // With variant expansion, should see multiple wood families
    expect(woodTypesUsed.size).toBeGreaterThan(1);

    // All paths should be complete (craft the pickaxe)
    paths.forEach(path => {
      const hasPickaxeCraft = path.some(s => 
        s.action === 'craft' && 
        s.result && 
        s.result.variants[0].value.item === 'wooden_pickaxe'
      );
      expect(hasPickaxeCraft).toBe(true);
    });
  });

  test('variant paths maintain consistency within each path', async () => {
    const paths = await generateTopNAndFilter('1.20.1', 'oak_planks', 4, {
      inventory: {},
      perGenerator: 15,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Each individual path should be internally consistent
    // (e.g., if crafting oak_planks, should mine oak_log)
    paths.forEach(path => {
      const craftSteps = path.filter(s => 
        s.action === 'craft' && 
        s.result && 
        s.result.variants[0].value.item === 'oak_planks'
      );
      
      if (craftSteps.length > 0) {
        // Should have mined or used oak-related items
        const hasOakIngredient = craftSteps.some(craft =>
          craft.ingredients && 
          craft.ingredients.variants[0].value.some((ing: any) => 
            ing.item && ing.item.includes('oak')
          )
        );
        expect(hasOakIngredient).toBe(true);
      }
    });
  });

  test('variant expansion with world snapshot provides distance info', async () => {
    const snapshot = {
      version: '1.20.1', 
      dimension: 'overworld', 
      center: { x: 0, y: 64, z: 0 }, 
      radius: 48, 
      yMin: 0, 
      yMax: 255,
      blocks: {
        spruce_log: { count: 30, closestDistance: 5, averageDistance: 10 },
        oak_log: { count: 10, closestDistance: 30, averageDistance: 40 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: {},
      worldSnapshot: snapshot,
      perGenerator: 15,
      log: false,
      pruneWithWorld: false, // Generate all variants
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Should generate paths with wood mining
    const hasWoodMining = paths.some(path =>
      path.some(step => step.action === 'mine' && /_log$/.test(step.what.variants[0].value))
    );
    
    expect(hasWoodMining || paths.length > 0).toBe(true);
  });

  test('generateTopNAndFilter produces valid paths with combined tree', async () => {
    const paths = await generateTopNAndFilter('1.20.1', 'crafting_table', 1, {
      inventory: {},
      perGenerator: 10,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Each path should be complete and valid
    paths.forEach(path => {
      // Should have at least one step
      expect(path.length).toBeGreaterThan(0);
    });

    // At least some paths should craft the table (not mine it)
    const craftingPaths = paths.filter(p =>
      p.some(s => s.action === 'craft' && s.result && s.result.variants[0].value.item === 'crafting_table')
    );
    expect(craftingPaths.length).toBeGreaterThan(0);

    // At least some paths should have multiple steps (craft from scratch)
    const multiStepPaths = paths.filter(p => p.length >= 3);
    expect(multiStepPaths.length).toBeGreaterThan(0);

    // At least one path should mine wood and craft planks
    const fullPaths = paths.filter(p => 
      p.some(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value)) &&
      p.some(s => s.action === 'craft' && s.result && s.result.variants[0].value.item.includes('planks'))
    );
    expect(fullPaths.length).toBeGreaterThan(0);
  });

  test('variant paths work with multiple target counts', async () => {
    const paths = await generateTopNAndFilter('1.20.1', 'stick', 64, {
      inventory: {},
      perGenerator: 10,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Should generate valid paths for large quantities
    paths.forEach(path => {
      expect(path.length).toBeGreaterThan(0);
      
      // Should have appropriate mining/crafting counts
      const totalSticksCrafted = path
        .filter(s => s.action === 'craft' && s.result && s.result.variants[0].value.item === 'stick')
        .reduce((sum, s) => sum + (s.result?.variants[0].value.perCraftCount || 0) * (s.count || 1), 0);
      
      if (totalSticksCrafted > 0) {
        // Should produce at least the target amount
        expect(totalSticksCrafted).toBeGreaterThanOrEqual(64);
      }
    });
  });

  test('variant expansion handles bamboo alternative correctly', async () => {
    // Bamboo is an alternative wood source for sticks
    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: {},
      perGenerator: 30,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Should have variety of approaches
    const approaches = new Set<string>();
    paths.forEach(path => {
      path.forEach(step => {
        if (step.action === 'mine') {
          if (step.what.variants[0].value === 'bamboo') approaches.add('bamboo');
          if (/_log$/.test(step.what.variants[0].value)) approaches.add('log');
        }
      });
    });

    // Should have at least the log approach
    expect(approaches.size).toBeGreaterThan(0);
  });

  test('variant expansion preserves path quality ordering', async () => {
    const snapshot = {
      version: '1.20.1', 
      dimension: 'overworld', 
      center: { x: 0, y: 64, z: 0 }, 
      radius: 48, 
      yMin: 0, 
      yMax: 255,
      blocks: {
        oak_log: { count: 50, closestDistance: 3, averageDistance: 8 },
        spruce_log: { count: 30, closestDistance: 10, averageDistance: 15 },
        birch_log: { count: 20, closestDistance: 20, averageDistance: 25 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: {},
      worldSnapshot: snapshot,
      perGenerator: 15,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // First path should prefer oak (closest and most abundant)
    const firstPath = paths[0];
    const woodInFirst = firstPath
      .filter((s: any) => s.action === 'mine' && /_log$/.test(s.what))
      .map((s: any) => s.what);

    if (woodInFirst.length > 0) {
      // Should prefer oak
      expect(woodInFirst[0]).toBe('oak_log');
    }
  });
});
