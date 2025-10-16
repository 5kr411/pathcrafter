import { describe, it, expect, beforeEach } from '@jest/globals';
import plan from '../../planner';
import { WorldSnapshot } from '../../utils/worldSnapshotTypes';

describe('integration: stone tool recipe variants', () => {
  let mcData: any;

  beforeEach(() => {
    mcData = require('minecraft-data')('1.20.1');
  });

  describe('tree building with multi-variant stone craft nodes', () => {
    it('should create stone_pickaxe craft node with 3 ingredient variants', () => {
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
      expect(craftNode.ingredients).toBeDefined();
      expect(craftNode.ingredients.variants).toBeDefined();
      expect(craftNode.ingredients.variants.length).toBeGreaterThanOrEqual(3);

      const ingredientVariants = craftNode.ingredients.variants;
      const stoneIngredients = ingredientVariants
        .map((v: any) => v.value)
        .flat()
        .map((ing: any) => ing.item)
        .filter((item: string) => 
          item === 'cobblestone' || 
          item === 'cobbled_deepslate' || 
          item === 'blackstone'
        );

      expect(stoneIngredients).toContain('cobblestone');
      expect(stoneIngredients).toContain('cobbled_deepslate');
      expect(stoneIngredients).toContain('blackstone');
    });

    it('should create stone_axe craft node with 3 ingredient variants', () => {
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

      const ingredientVariants = craftNode.ingredients.variants;
      const stoneIngredients = ingredientVariants
        .map((v: any) => v.value)
        .flat()
        .map((ing: any) => ing.item)
        .filter((item: string) => 
          item === 'cobblestone' || 
          item === 'cobbled_deepslate' || 
          item === 'blackstone'
        );

      expect(stoneIngredients).toContain('cobblestone');
      expect(stoneIngredients).toContain('cobbled_deepslate');
      expect(stoneIngredients).toContain('blackstone');
    });
  });

  describe('tree structure preserves stone variants', () => {
    it('should have stone variants available in tree structure', () => {
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

      expect(stoneTypes.size).toBe(3);
      expect(stoneTypes.has('cobblestone')).toBe(true);
      expect(stoneTypes.has('cobbled_deepslate')).toBe(true);
      expect(stoneTypes.has('blackstone')).toBe(true);
    });
  });

  describe('world filtering with stone variants', () => {
    it('should build tree with deepslate when only deepslate is available', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          deepslate: { count: 50, closestDistance: 10, averageDistance: 15 },
          oak_log: { count: 20, closestDistance: 5, averageDistance: 10 }
        },
        entities: {}
      };

      const tree = plan(mcData, 'stone_pickaxe', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      expect(tree).toBeDefined();
      expect(tree.children.variants.length).toBeGreaterThan(0);
    });

    it('should build tree with blackstone when only blackstone is available', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'nether',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          blackstone: { count: 50, closestDistance: 10, averageDistance: 15 },
          crimson_stem: { count: 20, closestDistance: 5, averageDistance: 10 }
        },
        entities: {}
      };

      const tree = plan(mcData, 'stone_pickaxe', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      expect(tree).toBeDefined();
      expect(tree.children.variants.length).toBeGreaterThan(0);
    });
  });
});

