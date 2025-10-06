import { plan } from '../../planner';
import { generateTopNPathsFromGenerators } from '../../path_generators/generateTopN';
import { enumerateActionPathsGenerator } from '../../path_generators/actionPathsGenerator';
import { enumerateShortestPathsGenerator } from '../../path_generators/shortestPathsGenerator';
import { enumerateLowestWeightPathsGenerator } from '../../path_generators/lowestWeightPathsGenerator';

describe('unit: path generation with combined tree variants', () => {
  const { resolveMcData } = (plan as any)._internals;
  const mcData = resolveMcData('1.20.1');

  test('path generation includes mine node variant metadata', () => {
    // Generate a tree with combined similar nodes
    const tree = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    // Generate paths using action generator
    const paths: any[] = [];
    const gen = enumerateActionPathsGenerator(tree, { inventory: {} });
    
    let count = 0;
    for (const path of gen) {
      paths.push(path);
      count++;
      if (count >= 20) break; // Should need far fewer iterations now
    }

    expect(paths.length).toBeGreaterThan(0);

    // Find paths that mine logs
    const miningPaths = paths.filter(p => 
      p.some((step: any) => step.action === 'mine' && /_log$/.test(step.what))
    );

    expect(miningPaths.length).toBeGreaterThan(0);

    // Find mining steps with variants
    const stepsWithVariants = miningPaths.flatMap((path: any[]) => 
      path.filter(step => 
        step.action === 'mine' && 
        step.whatVariants && 
        step.whatVariants.length > 1
      )
    );

    expect(stepsWithVariants.length).toBeGreaterThan(0);

    // Check that variant metadata includes multiple wood types
    stepsWithVariants.forEach(step => {
      expect(step.whatVariants).toBeDefined();
      expect(step.whatVariants.length).toBeGreaterThan(1);
      expect(step.targetItemVariants).toBeDefined();
      expect(step.variantMode).toBe('one_of');
      
      // Should include common wood types
      const hasCommonWood = step.whatVariants.some((v: string) => 
        ['oak_log', 'spruce_log', 'birch_log', 'jungle_log'].includes(v)
      );
      expect(hasCommonWood).toBe(true);
    });
  });

  test('path generation includes craft node variant metadata', () => {
    // Generate a tree with combined similar nodes
    const tree = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    // Generate paths
    const paths: any[] = [];
    const gen = enumerateActionPathsGenerator(tree, { inventory: {} });
    
    let count = 0;
    for (const path of gen) {
      paths.push(path);
      count++;
      if (count >= 20) break;
    }

    // Find paths that craft planks
    const planksCraftPaths = paths.filter(p =>
      p.some((step: any) => 
        step.action === 'craft' && 
        step.result && 
        step.result.item.includes('planks')
      )
    );

    expect(planksCraftPaths.length).toBeGreaterThan(0);

    // Find craft steps with variants
    const stepsWithVariants = planksCraftPaths.flatMap((path: any[]) => 
      path.filter(step => 
        step.action === 'craft' && 
        step.resultVariants && 
        step.resultVariants.length > 1
      )
    );

    expect(stepsWithVariants.length).toBeGreaterThan(0);

    // Find steps with actual variety in variants (not all the same)
    const stepsWithActualVariety = stepsWithVariants.filter(step => {
      const uniqueVariants = [...new Set(step.resultVariants)];
      return uniqueVariants.length > 1;
    });

    expect(stepsWithActualVariety.length).toBeGreaterThan(0);

    // Check that variant metadata includes multiple plank types
    stepsWithActualVariety.forEach(step => {
      expect(step.resultVariants).toBeDefined();
      expect(step.resultVariants.length).toBeGreaterThan(1);
      expect(step.ingredientVariants).toBeDefined();
      expect(step.variantMode).toBe('one_of');
      
      // Should include common plank types (dedupe to unique values)
      const uniqueVariants = [...new Set(step.resultVariants)];
      expect(uniqueVariants.length).toBeGreaterThan(1);
      
      // At least one should have common wood planks
      if (uniqueVariants.some((v: any) => v.includes('planks'))) {
        const hasOak = uniqueVariants.includes('oak_planks');
        const hasSpruce = uniqueVariants.includes('spruce_planks');
        const hasBirch = uniqueVariants.includes('birch_planks');
        expect(hasOak || hasSpruce || hasBirch).toBe(true);
      }
    });
  });

  test('shortest path generator includes variant metadata', () => {
    const tree = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    const paths: any[] = [];
    const gen = enumerateShortestPathsGenerator(tree, { inventory: {} });
    
    let count = 0;
    for (const path of gen) {
      paths.push(path);
      count++;
      if (count >= 10) break; // Need fewer with metadata approach
    }

    expect(paths.length).toBeGreaterThan(0);

    // All paths should be valid (have at least one step)
    paths.forEach(path => {
      expect(path.length).toBeGreaterThan(0);
    });

    // Find steps with variant metadata
    const stepsWithVariants = paths.flatMap((path: any[]) => 
      path.filter(step => 
        (step.whatVariants && step.whatVariants.length > 1) ||
        (step.resultVariants && step.resultVariants.length > 1)
      )
    );

    expect(stepsWithVariants.length).toBeGreaterThan(0);
  });

  test('lowest weight path generator handles variants correctly', () => {
    const tree = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    const paths: any[] = [];
    const gen = enumerateLowestWeightPathsGenerator(tree, { inventory: {} });
    
    let count = 0;
    for (const path of gen) {
      paths.push(path);
      count++;
      if (count >= 50) break;
    }

    expect(paths.length).toBeGreaterThan(0);

    // All paths should be valid
    paths.forEach(path => {
      expect(path.length).toBeGreaterThan(0);
    });
  });

  test('variant metadata maintains correct ingredient structure', () => {
    const tree = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    const paths: any[] = [];
    const gen = enumerateActionPathsGenerator(tree, { inventory: {} });
    
    let count = 0;
    for (const path of gen) {
      paths.push(path);
      count++;
      if (count >= 20) break;
    }

    // Find plank crafting steps with variants
    const planksCraftSteps = paths.flatMap((path: any[]) => 
      path.filter(step => 
        step.action === 'craft' && 
        step.result && 
        step.result.item.includes('planks') &&
        step.resultVariants &&
        step.resultVariants.length > 1
      )
    );

    expect(planksCraftSteps.length).toBeGreaterThan(0);

    // Check that variant metadata maintains proper structure
    planksCraftSteps.forEach(step => {
      // Primary result should have ingredients
      expect(step.ingredients).toBeDefined();
      expect(step.ingredients.length).toBeGreaterThan(0);
      
      // Ingredient variants should match result variants count
      expect(step.ingredientVariants).toBeDefined();
      expect(step.ingredientVariants.length).toBe(step.resultVariants.length);
      
      // Each ingredient variant should have same length as primary ingredients
      step.ingredientVariants.forEach((variantIngs: any[]) => {
        expect(variantIngs.length).toBe(step.ingredients.length);
      });
    });
  });

  test('combined trees include variant metadata, non-combined do not', () => {
    // Tree without combining
    const treeNoCombine = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: false 
    });

    const pathsNoCombine: any[] = [];
    const genNoCombine = enumerateActionPathsGenerator(treeNoCombine, { inventory: {} });
    
    let count = 0;
    for (const path of genNoCombine) {
      pathsNoCombine.push(path);
      count++;
      if (count >= 20) break;
    }

    // Tree with combining
    const treeCombined = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    const pathsCombined: any[] = [];
    const genCombined = enumerateActionPathsGenerator(treeCombined, { inventory: {} });
    
    count = 0;
    for (const path of genCombined) {
      pathsCombined.push(path);
      count++;
      if (count >= 20) break;
    }

    // Both should generate paths
    expect(pathsNoCombine.length).toBeGreaterThan(0);
    expect(pathsCombined.length).toBeGreaterThan(0);

    // Non-combined should have NO variant metadata
    const noCombineWithVariants = pathsNoCombine.flatMap((path: any[]) => 
      path.filter(step => step.whatVariants || step.resultVariants)
    );
    expect(noCombineWithVariants.length).toBe(0);

    // Combined should have variant metadata
    const combinedWithVariants = pathsCombined.flatMap((path: any[]) => 
      path.filter(step => 
        (step.whatVariants && step.whatVariants.length > 1) ||
        (step.resultVariants && step.resultVariants.length > 1)
      )
    );
    expect(combinedWithVariants.length).toBeGreaterThan(0);
  });

  test('generateTopNPathsFromGenerators works with combined tree', async () => {
    const tree = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    const paths = await generateTopNPathsFromGenerators(tree, { inventory: {} }, 10);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThanOrEqual(30); // 10 per generator * 3 generators

    // All paths should be valid
    paths.forEach(path => {
      expect(path).toBeDefined();
      expect(path.length).toBeGreaterThan(0);
    });

    // Should have variety in approaches
    const hasMinedLog = paths.some(p => 
      p.some(step => step.action === 'mine' && /_log$/.test(step.what))
    );
    
    expect(hasMinedLog).toBe(true);
  });

  test('variant metadata preserves targetItem variants correctly', () => {
    const tree = plan(mcData, 'stick', 1, { 
      log: false, 
      inventory: {}, 
      combineSimilarNodes: true 
    });

    const paths: any[] = [];
    const gen = enumerateActionPathsGenerator(tree, { inventory: {} });
    
    let count = 0;
    for (const path of gen) {
      paths.push(path);
      count++;
      if (count >= 20) break;
    }

    // Find mining steps with variants
    const miningStepsWithVariants: any[] = [];
    paths.forEach(path => {
      path.forEach((step: any) => {
        if (step.action === 'mine' && step.whatVariants && step.whatVariants.length > 1) {
          miningStepsWithVariants.push(step);
        }
      });
    });

    expect(miningStepsWithVariants.length).toBeGreaterThan(0);

    // Each mining step with variants should have targetItemVariants
    miningStepsWithVariants.forEach(step => {
      expect(step.targetItemVariants).toBeDefined();
      expect(step.targetItemVariants.length).toBe(step.whatVariants.length);
      expect(typeof step.targetItemVariants[0]).toBe('string');
    });
  });
});
