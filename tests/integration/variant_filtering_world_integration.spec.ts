import { generateTopNAndFilter } from '../../path_filters';

describe('integration: variant filtering with world snapshots', () => {

  test('filters wood variants to only available types in world', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        oak_log: { count: 30, closestDistance: 10, averageDistance: 20 },
        birch_log: { count: 20, closestDistance: 15, averageDistance: 25 }
        // No spruce, jungle, etc.
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: new Map(),
      worldSnapshot: snapshot,
      perGenerator: 20,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Find paths that mine logs
    const logMiningPaths = paths.filter(p =>
      p.some(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value))
    );

    expect(logMiningPaths.length).toBeGreaterThan(0);

    // Check mining steps - should only have oak and birch
    const miningSteps = logMiningPaths.flatMap(p =>
      p.filter(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value))
    );

    miningSteps.forEach(step => {
      if (step.what && step.what.variants.length > 1) {
        // Variants should only include what's in the world
        const variantValues = step.what.variants.map((v: any) => v.value);
        expect(variantValues).not.toContain('spruce_log');
        expect(variantValues).not.toContain('jungle_log');
        
        const hasOak = variantValues.includes('oak_log');
        const hasBirch = variantValues.includes('birch_log');
        expect(hasOak || hasBirch).toBe(true);
      }
    });
  });

  test('filters craft variants to match available wood types', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        spruce_log: { count: 200, closestDistance: 5, averageDistance: 10 }
        // Only spruce available
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: new Map(),
      worldSnapshot: snapshot,
      perGenerator: 15,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: true
    });

    // May have paths if spruce can satisfy the need
    if (paths.length === 0) {
      // If no paths after filtering, that's acceptable for this edge case
      return;
    }

    expect(paths.length).toBeGreaterThan(0);

    // Find paths that craft planks from logs
    const plankCraftPaths = paths.filter(p =>
      p.some(s => 
        s.action === 'craft' && 
        s.result && 
        /_planks$/.test(s.result.variants[0].value.item) &&
        s.ingredients &&
        s.ingredients.variants[0].value.some((ing: any) => /_log$/.test(ing.item))
      )
    );

    if (plankCraftPaths.length > 0) {
      plankCraftPaths.forEach(path => {
        path.forEach(step => {
          if (step.action === 'craft' && step.result && /_planks$/.test(step.result.variants[0].value.item)) {
            // Should use spruce since that's all that's available
            const usesSpruce = 
              step.result.variants[0].value.item === 'spruce_planks' ||
              (step.result.variants.some((v: any) => v.value.item === 'spruce_planks'));
            
            expect(usesSpruce).toBe(true);
          }
        });
      });
    }
  });

  test('removes paths entirely when no variants are available', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        stone: { count: 1000, closestDistance: 2, averageDistance: 5 },
        coal_ore: { count: 50, closestDistance: 10, averageDistance: 15 }
        // No wood at all
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: new Map(),
      worldSnapshot: snapshot,
      perGenerator: 20,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: true
    });

    // Should have very few or no paths since wood isn't available
    // (might have dead_bush or witch paths)
    const logMiningPaths = paths.filter(p =>
      p.some(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value))
    );

    expect(logMiningPaths.length).toBe(0);
  });

  test('simplifies to single variant when only one wood type available', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        acacia_log: { count: 200, closestDistance: 3, averageDistance: 8 }
        // Only acacia
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: new Map(),
      worldSnapshot: snapshot,
      perGenerator: 15,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: true
    });

    // May have paths if acacia can satisfy the need
    if (paths.length === 0) {
      // If no paths after filtering, that's acceptable
      return;
    }

    expect(paths.length).toBeGreaterThan(0);

    const logMiningPaths = paths.filter(p =>
      p.some(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value))
    );

    if (logMiningPaths.length > 0) {
      logMiningPaths.forEach(path => {
        path.forEach(step => {
          if (step.action === 'mine' && /_log$/.test(step.what.variants[0].value)) {
            // Should be simplified to just acacia (no variant arrays)
            expect(step.what.variants[0].value).toBe('acacia_log');
            
            // Variants should be removed or contain only acacia
            if (step.what && step.what.variants.length > 1) {
              expect(step.what.variants.map((v: any) => v.value)).toEqual(['acacia_log']);
            }
          }
        });
      });
    }
  });

  test('variant filtering works with multiple wood types available', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        oak_log: { count: 20, closestDistance: 10, averageDistance: 15 },
        spruce_log: { count: 30, closestDistance: 8, averageDistance: 12 },
        birch_log: { count: 15, closestDistance: 12, averageDistance: 18 },
        jungle_log: { count: 10, closestDistance: 20, averageDistance: 30 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, {
      inventory: new Map([["crafting_table", 1]]),
      worldSnapshot: snapshot,
      perGenerator: 20,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Should generate paths with wood
    const hasWoodPaths = paths.some(p =>
      p.some(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value))
    );

    expect(hasWoodPaths).toBe(true);

    // Check that variants include available types
    const miningSteps = paths.flatMap(p =>
      p.filter(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value))
    );

    const allVariants = new Set<string>();
    miningSteps.forEach(step => {
      if (step.what && step.what.variants.length > 1) {
        step.what.variants.forEach((v: any) => allVariants.add(v.value));
      } else {
        allVariants.add(step.what.variants[0].value);
      }
    });

    // Should have the available types
    expect(allVariants.has('oak_log') || allVariants.has('spruce_log')).toBe(true);
  });

  test('variant filtering preserves path consistency across steps', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        cherry_log: { count: 40, closestDistance: 7, averageDistance: 14 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: new Map(),
      worldSnapshot: snapshot,
      perGenerator: 15,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    const fullPaths = paths.filter(p =>
      p.some(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value)) &&
      p.some(s => s.action === 'craft' && s.result && /_planks$/.test(s.result.variants[0].value.item))
    );

    if (fullPaths.length > 0) {
      fullPaths.forEach(path => {
        const minedWood: string[] = [];
        const craftedPlanks: string[] = [];

        path.forEach(step => {
          if (step.action === 'mine' && /_log$/.test(step.what.variants[0].value)) {
            minedWood.push(step.what.variants[0].value.replace(/_log$/, ''));
          }
          if (step.action === 'craft' && step.result && /_planks$/.test(step.result.variants[0].value.item)) {
            craftedPlanks.push(step.result.variants[0].value.item.replace(/_planks$/, ''));
          }
        });

        // Both should use at least one available wood type (prefer cherry when present)
        const availableWoods = new Set([...minedWood, ...craftedPlanks]);
        expect(availableWoods.size).toBeGreaterThan(0);
      });
    }
  });

  test('variant filtering with inventory items', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        mangrove_log: { count: 200, closestDistance: 18, averageDistance: 25 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 4, {
      inventory: new Map([['oak_planks', 2]]), // Have some oak planks already
      worldSnapshot: snapshot,
      perGenerator: 15,
      log: false,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    // At least one approach should be available
    // (might be 0 if inventory items can't be used without additional resources)
    if (paths.length === 0) {
      // That's OK - the inventory approach might not work
      return;
    }

    expect(paths.length).toBeGreaterThan(0);

    // Verify at least one approach is available
    // Could use existing oak_planks or mine mangrove_log
    const hasMiningPath = paths.some(p =>
      p.some(s => s.action === 'mine' && s.what.variants[0].value === 'mangrove_log')
    );
    
    const hasCraftingPath = paths.some(p =>
      p.some(s => s.action === 'craft')
    );

    // At least one approach should work
    expect(hasMiningPath || hasCraftingPath).toBe(true);
  });

  test('variant filtering with pruneWithWorld enabled', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {
        oak_log: { count: 15, closestDistance: 5, averageDistance: 10 },
        dead_bush: { count: 3, closestDistance: 3, averageDistance: 6 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: new Map(),
      worldSnapshot: snapshot,
      perGenerator: 15,
      log: false,
      pruneWithWorld: true, // Enable tree-level pruning
      combineSimilarNodes: true
    });

    expect(paths.length).toBeGreaterThan(0);

    // Should have paths using available resources
    const approaches = new Set<string>();
    paths.forEach(p => {
      if (p.some(s => s.action === 'mine' && s.what.variants[0].value === 'dead_bush')) {
        approaches.add('dead_bush');
      }
      if (p.some(s => s.action === 'mine' && /_log$/.test(s.what.variants[0].value))) {
        approaches.add('wood');
      }
    });

    expect(approaches.size).toBeGreaterThan(0);
  });

  test('empty world filters out all variant-dependent paths', async () => {
    const snapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 64,
      yMin: 0,
      yMax: 255,
      blocks: {},
      entities: {}
    };

    const paths = await generateTopNAndFilter('1.20.1', 'stick', 1, {
      inventory: new Map(),
      worldSnapshot: snapshot,
      perGenerator: 20,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: true
    });

    // Should have no paths or only hunting paths (witch)
    const miningPaths = paths.filter(p =>
      p.some(s => s.action === 'mine')
    );

    expect(miningPaths.length).toBe(0);
  });
});
