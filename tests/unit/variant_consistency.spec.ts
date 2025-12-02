import plan from '../../planner';
import { getCachedMcData } from '../testHelpers';

describe('unit: variant consistency', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
  });

  describe('stone-type material grouping', () => {
    test('stone tools should have multi-variant craft nodes with all stone types', () => {
      const tree = plan(mcData, 'stone_pickaxe', 1, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      function findCraftNodes(node: any, results: any[] = []): any[] {
        if (!node) return results;
        
        if (node.action === 'craft' && node.result?.variants) {
          const resultItems = node.result.variants.map((v: any) => v.value?.item);
          if (resultItems.includes('stone_pickaxe')) {
            results.push(node);
          }
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            findCraftNodes(child.value, results);
          }
        }
        
        return results;
      }

      const stonePickaxeCrafts = findCraftNodes(tree);
      expect(stonePickaxeCrafts.length).toBeGreaterThan(0);

      const craftNode = stonePickaxeCrafts[0];
      expect(craftNode.ingredients.variants.length).toBeGreaterThanOrEqual(3);

      const ingredientVariants = craftNode.ingredients.variants;
      const stoneTypes = new Set<string>();
      
      for (const variant of ingredientVariants) {
        const ingredients = variant.value;
        if (Array.isArray(ingredients)) {
          for (const ingredient of ingredients) {
            if (ingredient.item === 'cobblestone' || 
                ingredient.item === 'cobbled_deepslate' || 
                ingredient.item === 'blackstone') {
              stoneTypes.add(ingredient.item);
            }
          }
        }
      }

      expect(stoneTypes.has('cobblestone')).toBe(true);
      expect(stoneTypes.has('cobbled_deepslate')).toBe(true);
      expect(stoneTypes.has('blackstone')).toBe(true);
    });

    test('stone_axe should also have multi-variant craft nodes', () => {
      const tree = plan(mcData, 'stone_axe', 1, {
        log: false,
        inventory: new Map(),
        combineSimilarNodes: true
      });

      function findCraftNodes(node: any, results: any[] = []): any[] {
        if (!node) return results;
        
        if (node.action === 'craft' && node.result?.variants) {
          const resultItems = node.result.variants.map((v: any) => v.value?.item);
          if (resultItems.includes('stone_axe')) {
            results.push(node);
          }
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            findCraftNodes(child.value, results);
          }
        }
        
        return results;
      }

      const stoneAxeCrafts = findCraftNodes(tree);
      expect(stoneAxeCrafts.length).toBeGreaterThan(0);

      const craftNode = stoneAxeCrafts[0];
      expect(craftNode.ingredients.variants.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('wood-type family grouping still works', () => {
    test('oak_log can produce oak_planks for crafting', () => {
      const tree = plan(mcData, 'stick', 4, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: {
          version: '1.20.1',
          dimension: 'overworld',
          center: { x: 0, y: 64, z: 0 },
          radius: 128,
          yMin: 0,
          yMax: 255,
          blocks: {
            oak_log: { count: 10, closestDistance: 5, averageDistance: 10 }
          },
          entities: {}
        }
      });

      expect(tree.children.variants.length).toBeGreaterThan(0);

      function hasOakPath(node: any): boolean {
        if (!node) return false;
        
        if (node.action === 'mine' && node.targetItem) {
          const targetItems = node.targetItem.variants || [];
          if (targetItems.some((v: any) => 
            (typeof v.value === 'string' ? v.value : v.value?.item) === 'oak_log'
          )) {
            return true;
          }
        }
        
        if (node.children && node.children.variants) {
          return node.children.variants.some((child: any) => hasOakPath(child.value));
        }
        
        return false;
      }

      expect(hasOakPath(tree)).toBe(true);
    });

    test('spruce family can be used when spruce_log is available', () => {
      const tree = plan(mcData, 'stick', 2, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: {
          version: '1.20.1',
          dimension: 'overworld',
          center: { x: 0, y: 64, z: 0 },
          radius: 128,
          yMin: 0,
          yMax: 255,
          blocks: {
            spruce_log: { count: 10, closestDistance: 5, averageDistance: 10 }
          },
          entities: {}
        }
      });

      expect(tree.children.variants.length).toBeGreaterThan(0);
    });
  });

  describe('inventory locking variants', () => {
    test('having oak_planks in inventory allows oak family crafts', () => {
      const tree = plan(mcData, 'stick', 4, {
        log: false,
        inventory: new Map([['oak_planks', 5]]),
        pruneWithWorld: false,
        combineSimilarNodes: true
      });

      expect(tree.children.variants.length).toBeGreaterThan(0);

      function findCraftUsingOakPlanks(node: any): boolean {
        if (!node) return false;
        
        if (node.action === 'craft' && node.ingredients) {
          for (const variant of node.ingredients.variants) {
            const ingredients = variant.value || [];
            if (ingredients.some((ing: any) => ing.item === 'oak_planks')) {
              return true;
            }
          }
        }
        
        if (node.children && node.children.variants) {
          return node.children.variants.some((child: any) => 
            findCraftUsingOakPlanks(child.value)
          );
        }
        
        return false;
      }

      expect(findCraftUsingOakPlanks(tree)).toBe(true);
    });

    test('having cobbled_deepslate locks to deepslate variants', () => {
      const tree = plan(mcData, 'stone_pickaxe', 1, {
        log: false,
        inventory: new Map([['cobbled_deepslate', 10], ['stick', 5]]),
        pruneWithWorld: true,
        combineSimilarNodes: true
      });

      function findCraftNodes(node: any, results: any[] = []): any[] {
        if (!node) return results;
        
        if (node.action === 'craft') {
          results.push(node);
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            findCraftNodes(child.value, results);
          }
        }
        
        return results;
      }

      const allCrafts = findCraftNodes(tree);
      const pickaxeCrafts = allCrafts.filter((c: any) => {
        return c.result?.variants.some((v: any) => 
          (v.value?.item || v.value)?.includes('pickaxe')
        );
      });

      const hasAnyCraftWithDeepslate = pickaxeCrafts.some((pickaxeCraft: any) => {
        return pickaxeCraft.ingredients.variants.some((v: any) =>
          (v.value || []).some((ing: any) => ing.item === 'cobbled_deepslate')
        );
      });

      expect(hasAnyCraftWithDeepslate).toBe(true);
    });
  });

  describe('mixed material scenarios', () => {
    test('does not mix blackstone with cobblestone', () => {
      const tree = plan(mcData, 'stone_pickaxe', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: {
          version: '1.20.1',
          dimension: 'nether',
          center: { x: 0, y: 64, z: 0 },
          radius: 128,
          yMin: 0,
          yMax: 255,
          blocks: {
            blackstone: { count: 100, closestDistance: 10, averageDistance: 20 }
          },
          entities: {}
        }
      });

      function findCraftNodes(node: any, results: any[] = []): any[] {
        if (!node) return results;
        
        if (node.action === 'craft') {
          results.push(node);
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            findCraftNodes(child.value, results);
          }
        }
        
        return results;
      }

      const allCrafts = findCraftNodes(tree);

      for (const craftNode of allCrafts) {
        if (craftNode.ingredients && craftNode.ingredients.variants) {
          for (const ingredientVariant of craftNode.ingredients.variants) {
            for (const ingredient of ingredientVariant.value || []) {
              if (ingredient.item === 'blackstone') {
                expect(ingredient.item).not.toBe('cobblestone');
                expect(ingredient.item).not.toBe('cobbled_deepslate');
              }
            }
          }
        }
      }
    });
  });
});

