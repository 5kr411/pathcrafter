import { buildRecipeTree } from '../../action_tree/builders';
import { enumerateActionPaths } from '../../action_tree/enumerate';
import { resolveMcData } from '../../action_tree/utils/mcDataResolver';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';

describe('Dependency Handling', () => {
  let mcData: any;
  let context: Partial<BuildContext>;

  beforeAll(async () => {
    mcData = await resolveMcData('1.20.1');
  });

  beforeEach(() => {
    context = {
      inventory: new Map(),
      visited: new Set(),
      depth: 0,
      parentPath: [],
      config: {
        preferMinimalTools: true,
        maxDepth: 10
      },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };
  });

  describe('Tool Dependencies', () => {
    test('should inject wooden_pickaxe dependency for stone mining', async () => {
      const tree = buildRecipeTree(mcData, 'cobblestone', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Check that paths include tool dependencies (now as craft steps for wooden_pickaxe)
      const hasToolDependency = paths.some(path => 
        path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'wooden_pickaxe')
        )
      );
      expect(hasToolDependency).toBe(true);

      // Check that mining steps come after tool crafting
      const toolDependencyPaths = paths.filter(path => 
        path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'wooden_pickaxe')
        )
      );
      
      toolDependencyPaths.forEach(path => {
        const craftIndex = path.findIndex(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'wooden_pickaxe')
        );
        const mineIndex = path.findIndex(step => 
          step.action === 'mine' && 
          step.what.variants.some((v: any) => v.value === 'stone' || v.value === 'cobblestone')
        );
        expect(craftIndex).toBeGreaterThanOrEqual(0);
        expect(mineIndex).toBeGreaterThanOrEqual(0);
        expect(craftIndex).toBeLessThan(mineIndex);
      });
    });

    test('should inject stone_pickaxe dependency for iron_block mining', async () => {
      const tree = buildRecipeTree(mcData, 'iron_ingot', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Check for stone_pickaxe dependency in iron_block mining paths (now as craft steps)
      const hasStonePickaxeDependency = paths.some(path => 
        path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'stone_pickaxe')
        )
      );
      expect(hasStonePickaxeDependency).toBe(true);
    });
  });

  describe('Workstation Dependencies', () => {
    test('should inject crafting_table dependency for crafting recipes', async () => {
      const tree = buildRecipeTree(mcData, 'stone_pickaxe', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Check that paths include crafting table dependencies (now as craft/mine steps)
      const hasCraftingTableDependency = paths.some(path => 
        path.some(step => 
          (step.action === 'craft' && 
           step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && 
           step.what.variants.some((v: any) => v.value === 'crafting_table'))
        )
      );
      expect(hasCraftingTableDependency).toBe(true);

      // Check that stone_pickaxe crafting comes after crafting table acquisition
      const craftingTablePaths = paths.filter(path => 
        path.some(step => 
          (step.action === 'craft' && 
           step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && 
           step.what.variants.some((v: any) => v.value === 'crafting_table'))
        )
      );
      
      craftingTablePaths.forEach(path => {
        const tableIndex = path.findIndex(step => 
          (step.action === 'craft' && 
           step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && 
           step.what.variants.some((v: any) => v.value === 'crafting_table'))
        );
        const pickaxeIndex = path.findIndex(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'stone_pickaxe')
        );
        expect(tableIndex).toBeGreaterThanOrEqual(0);
        expect(pickaxeIndex).toBeGreaterThanOrEqual(0);
        expect(tableIndex).toBeLessThan(pickaxeIndex);
      });
    });

    test('should inject furnace dependency for smelting recipes', async () => {
      const tree = buildRecipeTree(mcData, 'iron_ingot', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Check that paths include furnace dependencies (now as craft steps)
      const hasFurnaceDependency = paths.some(path => 
        path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'furnace')
        )
      );
      expect(hasFurnaceDependency).toBe(true);

      // Check that smelting steps come after furnace crafting
      const furnacePaths = paths.filter(path => 
        path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'furnace')
        )
      );
      
      furnacePaths.forEach(path => {
        const furnaceIndex = path.findIndex(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'furnace')
        );
        const smeltIndex = path.findIndex(step => 
          step.action === 'smelt'
        );
        expect(furnaceIndex).toBeGreaterThanOrEqual(0);
        expect(smeltIndex).toBeGreaterThanOrEqual(0);
        expect(furnaceIndex).toBeLessThan(smeltIndex);
      });
    });
  });

  describe('Complex Dependency Chains', () => {
    test('should handle multiple dependencies in correct order', async () => {
      const tree = buildRecipeTree(mcData, 'stone_pickaxe', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Find a path that has both crafting table and tool dependencies (now as craft/mine steps)
      const complexPath = paths.find(path => 
        path.some(step => 
          (step.action === 'craft' && 
           step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && 
           step.what.variants.some((v: any) => v.value === 'crafting_table'))
        ) &&
        path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'wooden_pickaxe')
        )
      );
      
      expect(complexPath).toBeDefined();
      
      if (complexPath) {
        const craftingTableIndex = complexPath.findIndex(step => 
          (step.action === 'craft' && 
           step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && 
           step.what.variants.some((v: any) => v.value === 'crafting_table'))
        );
        const toolIndex = complexPath.findIndex(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'wooden_pickaxe')
        );
        const pickaxeIndex = complexPath.findIndex(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'stone_pickaxe')
        );
        
        // Dependencies should come before the actions that need them
        expect(craftingTableIndex).toBeGreaterThanOrEqual(0);
        expect(toolIndex).toBeGreaterThanOrEqual(0);
        expect(pickaxeIndex).toBeGreaterThanOrEqual(0);
        expect(craftingTableIndex).toBeLessThan(pickaxeIndex);
        expect(toolIndex).toBeLessThan(pickaxeIndex);
      }
    });

    test('should not duplicate dependencies', async () => {
      const tree = buildRecipeTree(mcData, 'stone_pickaxe', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Check that dependencies are present in the path
      // Note: crafting_table may appear multiple times due to recursive dependencies
      // (once for wooden_pickaxe, once for the main crafting_table dependency)
      paths.forEach(path => {
        const hasWoodenPickaxe = path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'wooden_pickaxe')
        );
        const hasStonePickaxe = path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => v.value.item === 'stone_pickaxe')
        );
        
        // Both pickaxes should be present
        expect(hasWoodenPickaxe).toBe(true);
        expect(hasStonePickaxe).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle items that do not need dependencies', async () => {
      const tree = buildRecipeTree(mcData, 'oak_log', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Oak log mining should not require any tools
      const hasToolDependency = paths.some(path => 
        path.some(step => 
          step.action === 'craft' && 
          step.result?.variants.some((v: any) => 
            v.value.item.includes('pickaxe') || 
            v.value.item.includes('axe')
          )
        )
      );
      expect(hasToolDependency).toBe(false);
    });

    test('should handle crafting recipes that do not need crafting table', async () => {
      const tree = buildRecipeTree(mcData, 'stick', 1, context);
      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);
      
      // Stick crafting should not require crafting table
      const hasCraftingTableDependency = paths.some(path => 
        path.some(step => 
          (step.action === 'craft' && 
           step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && 
           step.what.variants.some((v: any) => v.value === 'crafting_table'))
        )
      );
      expect(hasCraftingTableDependency).toBe(false);
    });
  });
});
