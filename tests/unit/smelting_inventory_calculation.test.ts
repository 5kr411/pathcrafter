import { buildRecipeTree } from '../../action_tree/builders';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';
import { enumerateActionPathsGenerator } from '../../path_generators/actionPathsGenerator';
import { getCachedMcData } from '../testHelpers';

describe('Smelting with Partial Inventory', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
  });

  test('should mine 2 raw_iron when 1 already in inventory and 3 iron_ingot needed', () => {
    // Scenario from logs: bot has 1 raw_iron, needs 3 iron_ingot, should mine 2 more
    const inventory = new Map([
      ['raw_iron', 1],     // Already have 1 raw_iron
      ['coal', 5],         // Have fuel
      ['furnace', 1],      // Have furnace
      ['stone_pickaxe', 1] // Have tool
    ]);

    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: {
        preferMinimalTools: true,
        maxDepth: 10
      },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'iron_ingot', 3, context);

    // Find a path that includes mining and smelting
    let foundValidPath = false;
    let pathsChecked = 0;
    const maxPaths = 50;

    const gen = enumerateActionPathsGenerator(tree, {});
    
    for (const path of gen) {
      pathsChecked++;
      if (pathsChecked > maxPaths) break;

      // Find the mine step for iron ore
      const mineStep = (path as any[]).find(step => 
        step.action === 'mine' && 
        (step.what?.variants?.some((v: any) => 
          v.value === 'iron_ore' || v.value === 'deepslate_iron_ore'
        ))
      );

      // Find the smelt step
      const smeltStep = (path as any[]).find(step => 
        step.action === 'smelt' && 
        step.result?.variants?.[0]?.value?.item === 'iron_ingot'
      );

      if (mineStep && smeltStep) {
        // We already have 1 raw_iron, need 3 iron_ingot total
        // So we should mine 2 more raw_iron (count should be 2)
        expect(mineStep.count).toBe(2);
        
        // The smelt step should smelt 3 iron_ingot
        expect(smeltStep.count).toBe(3);

        foundValidPath = true;
        break;
      }
    }

    expect(pathsChecked).toBeGreaterThan(0);
    expect(foundValidPath).toBe(true);
  });

  test('should mine 3 raw_iron when 0 in inventory and 3 iron_ingot needed', () => {
    // Control test: starting from scratch
    const inventory = new Map([
      ['coal', 5],
      ['furnace', 1],
      ['stone_pickaxe', 1]
    ]);

    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: {
        preferMinimalTools: true,
        maxDepth: 10
      },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'iron_ingot', 3, context);

    let foundValidPath = false;
    let pathsChecked = 0;
    const maxPaths = 50;

    const gen = enumerateActionPathsGenerator(tree, {});
    
    for (const path of gen) {
      pathsChecked++;
      if (pathsChecked > maxPaths) break;

      const mineStep = (path as any[]).find(step => 
        step.action === 'mine' && 
        (step.what?.variants?.some((v: any) => 
          v.value === 'iron_ore' || v.value === 'deepslate_iron_ore'
        ))
      );

      const smeltStep = (path as any[]).find(step => 
        step.action === 'smelt' && 
        step.result?.variants?.[0]?.value?.item === 'iron_ingot'
      );

      if (mineStep && smeltStep) {
        // Should mine 3 raw_iron when starting with 0
        expect(mineStep.count).toBe(3);
        expect(smeltStep.count).toBe(3);

        foundValidPath = true;
        break;
      }
    }

    expect(pathsChecked).toBeGreaterThan(0);
    expect(foundValidPath).toBe(true);
  });

  test('should mine 1 raw_iron when 2 in inventory and 3 iron_ingot needed', () => {
    // Edge case: already have 2, need 1 more
    const inventory = new Map([
      ['raw_iron', 2],
      ['coal', 5],
      ['furnace', 1],
      ['stone_pickaxe', 1]
    ]);

    const context: Partial<BuildContext> = {
      inventory,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: {
        preferMinimalTools: true,
        maxDepth: 10
      },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'iron_ingot', 3, context);

    let foundValidPath = false;
    let pathsChecked = 0;
    const maxPaths = 50;

    const gen = enumerateActionPathsGenerator(tree, {});
    
    for (const path of gen) {
      pathsChecked++;
      if (pathsChecked > maxPaths) break;

      const mineStep = (path as any[]).find(step => 
        step.action === 'mine' && 
        (step.what?.variants?.some((v: any) => 
          v.value === 'iron_ore' || v.value === 'deepslate_iron_ore'
        ))
      );

      const smeltStep = (path as any[]).find(step => 
        step.action === 'smelt' && 
        step.result?.variants?.[0]?.value?.item === 'iron_ingot'
      );

      if (mineStep && smeltStep) {
        // Should mine 1 more raw_iron when we have 2 and need 3
        expect(mineStep.count).toBe(1);
        expect(smeltStep.count).toBe(3);

        foundValidPath = true;
        break;
      }
    }

    expect(pathsChecked).toBeGreaterThan(0);
    expect(foundValidPath).toBe(true);
  });
});

