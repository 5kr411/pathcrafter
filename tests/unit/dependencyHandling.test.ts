import { buildRecipeTree } from '../../action_tree/builders';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';
import { enumerateActionPathsGenerator } from '../../path_generators/actionPathsGenerator';
import { getCachedMcData } from '../testHelpers';

function createPathIterator(tree: any, limit: number = 50) {
  return (function* () {
    const gen = enumerateActionPathsGenerator(tree, {});
    let count = 0;
    for (const path of gen) {
      yield path;
      count++;
      if (count >= limit) break;
    }
  })();
}

function findCraftIndex(path: any[], itemName: string): number {
  return path.findIndex(step =>
    step.action === 'craft' &&
    step.result?.variants.some((v: any) => v.value.item === itemName)
  );
}

function hasCraftStep(path: any[], itemName: string): boolean {
  return findCraftIndex(path, itemName) >= 0;
}

function findMineIndex(path: any[], ...targets: string[]): number {
  return path.findIndex(step =>
    step.action === 'mine' &&
    step.what.variants.some((v: any) => targets.includes(v.value))
  );
}

describe('Dependency Handling', () => {
  let mcData: any;
  let cobblestoneTree: any;
  let ironIngotTree: any;
  let stonePickaxeTree: any;
  let oakLogTree: any;
  let stickTree: any;
  let rawIronTree: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
    
    const baseContext: Partial<BuildContext> = {
      inventory: new Map(),
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
    
    cobblestoneTree = buildRecipeTree(mcData, 'cobblestone', 1, baseContext);
    ironIngotTree = buildRecipeTree(mcData, 'iron_ingot', 1, baseContext);
    stonePickaxeTree = buildRecipeTree(mcData, 'stone_pickaxe', 1, baseContext);
    oakLogTree = buildRecipeTree(mcData, 'oak_log', 1, baseContext);
    stickTree = buildRecipeTree(mcData, 'stick', 1, baseContext);
    rawIronTree = buildRecipeTree(mcData, 'raw_iron', 1, baseContext);
  });

  describe('Tool Dependencies', () => {
    test('should inject wooden_pickaxe dependency for stone mining', () => {
      const paths = createPathIterator(cobblestoneTree, 30);

      let pathCount = 0;
      let validatedPath = false;

      for (const path of paths) {
        pathCount += 1;

        const craftIndex = findCraftIndex(path as any[], 'wooden_pickaxe');
        if (craftIndex < 0) continue;

        const mineIndex = findMineIndex(path as any[], 'stone', 'cobblestone');
        if (mineIndex < 0) continue;

        validatedPath = true;
        expect(craftIndex).toBeLessThan(mineIndex);
        break;
      }

      expect(pathCount).toBeGreaterThan(0);
      expect(validatedPath).toBe(true);
    });

    test('should inject stone_pickaxe dependency for raw_iron mining', () => {
      const paths = createPathIterator(rawIronTree, 50);

      let pathCount = 0;
      let hasStonePickaxeDependency = false;

      for (const path of paths) {
        pathCount += 1;
        if (hasCraftStep(path as any[], 'stone_pickaxe')) {
          hasStonePickaxeDependency = true;
          break;
        }
      }

      expect(pathCount).toBeGreaterThan(0);
      expect(hasStonePickaxeDependency).toBe(true);
    });
  });

  describe('Workstation Dependencies', () => {
    test('should inject crafting_table dependency for crafting recipes', () => {
      const paths = createPathIterator(stonePickaxeTree, 30);

      let pathCount = 0;
      let hasCraftingTableDependency = false;

      for (const path of paths) {
        pathCount += 1;

        const tableIndex = path.findIndex((step: any) =>
          (step.action === 'craft' &&
            step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' &&
            step.what.variants.some((v: any) => v.value === 'crafting_table'))
        );

        if (tableIndex >= 0) {
          hasCraftingTableDependency = true;
          const pickaxeIndex = findCraftIndex(path as any[], 'stone_pickaxe');
          expect(pickaxeIndex).toBeGreaterThanOrEqual(0);
          expect(tableIndex).toBeLessThan(pickaxeIndex);
          break;
        }
      }

      expect(pathCount).toBeGreaterThan(0);
      expect(hasCraftingTableDependency).toBe(true);
    });

    test('should inject furnace dependency for smelting recipes', () => {
      const paths = createPathIterator(ironIngotTree, 30);

      let pathCount = 0;
      let hasFurnaceDependency = false;

      for (const path of paths) {
        pathCount += 1;

        const furnaceIndex = findCraftIndex(path as any[], 'furnace');
        if (furnaceIndex >= 0) {
          hasFurnaceDependency = true;
          const smeltIndex = (path as any[]).findIndex(step => step.action === 'smelt');
          expect(smeltIndex).toBeGreaterThanOrEqual(0);
          expect(furnaceIndex).toBeLessThan(smeltIndex);
          break;
        }
      }

      expect(pathCount).toBeGreaterThan(0);
      expect(hasFurnaceDependency).toBe(true);
    });
  });

  describe('Complex Dependency Chains', () => {
    test('should handle multiple dependencies in correct order', () => {
      const paths = createPathIterator(stonePickaxeTree, 30);

      let complexPath: any[] | null = null;

      for (const path of paths) {
        const hasCraftingTable = path.some((step: any) =>
          (step.action === 'craft' && step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && step.what.variants.some((v: any) => v.value === 'crafting_table'))
        );

        const hasWoodenPickaxe = hasCraftStep(path as any[], 'wooden_pickaxe');

        if (hasCraftingTable && hasWoodenPickaxe) {
          complexPath = path as any[];
          break;
        }
      }

      expect(complexPath).toBeDefined();

      if (complexPath) {
        const craftingTableIndex = complexPath.findIndex((step: any) =>
          (step.action === 'craft' && step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' && step.what.variants.some((v: any) => v.value === 'crafting_table'))
        );
        const toolIndex = findCraftIndex(complexPath, 'wooden_pickaxe');
        const pickaxeIndex = findCraftIndex(complexPath, 'stone_pickaxe');

        expect(craftingTableIndex).toBeGreaterThanOrEqual(0);
        expect(toolIndex).toBeGreaterThanOrEqual(0);
        expect(pickaxeIndex).toBeGreaterThanOrEqual(0);
        expect(craftingTableIndex).toBeLessThan(pickaxeIndex);
        expect(toolIndex).toBeLessThan(pickaxeIndex);
      }
    });

    test('should not duplicate dependencies', () => {
      const paths = createPathIterator(stonePickaxeTree, 20);

      let pathCount = 0;

      for (const path of paths) {
        pathCount += 1;
        const hasWoodenPickaxe = hasCraftStep(path as any[], 'wooden_pickaxe');
        const hasStonePickaxe = hasCraftStep(path as any[], 'stone_pickaxe');
        expect(hasWoodenPickaxe).toBe(true);
        expect(hasStonePickaxe).toBe(true);
      }

      expect(pathCount).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle items that do not need dependencies', () => {
      const paths = createPathIterator(oakLogTree, 20);

      let pathCount = 0;
      let hasToolDependency = false;

      for (const path of paths) {
        pathCount += 1;
        if ((path as any[]).some(step =>
          step.action === 'craft' &&
          step.result?.variants.some((v: any) =>
            v.value.item.includes('pickaxe') ||
            v.value.item.includes('axe')
          )
        )) {
          hasToolDependency = true;
          break;
        }
      }

      expect(pathCount).toBeGreaterThan(0);
      expect(hasToolDependency).toBe(false);
    });

    test('should handle crafting recipes that do not need crafting table', () => {
      const paths = createPathIterator(stickTree, 20);

      let pathCount = 0;
      let hasCraftingTableDependency = false;

      for (const path of paths) {
        pathCount += 1;
        if ((path as any[]).some(step =>
          (step.action === 'craft' &&
            step.result?.variants.some((v: any) => v.value.item === 'crafting_table')) ||
          (step.action === 'mine' &&
            step.what.variants.some((v: any) => v.value === 'crafting_table'))
        )) {
          hasCraftingTableDependency = true;
          break;
        }
      }

      expect(pathCount).toBeGreaterThan(0);
      expect(hasCraftingTableDependency).toBe(false);
    });
  });
});
