import { describe, it, expect, beforeEach } from '@jest/globals';
import plan from '../../planner';
import { WorldSnapshot } from '../../utils/worldSnapshotTypes';

describe('integration: stone tool recipe variants', () => {
  let mcData: any;

  beforeEach(() => {
    mcData = require('minecraft-data')('1.20.1');
  });

  describe('tree building with multi-variant stone craft nodes', () => {
    it('should create stone_pickaxe craft node with stone variants in children', () => {
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
      expect(craftNode.children).toBeDefined();
      expect(craftNode.children.variants).toBeDefined();

      const stoneBranch = craftNode.children.variants.find((child: any) => {
        const rootNode = child.value;
        if (rootNode.action !== 'root') return false;
        const whatItems = rootNode.what?.variants?.map((v: any) => v.value) || [];
        return whatItems.some((item: string) => 
          item === 'cobblestone' || 
          item === 'cobbled_deepslate' || 
          item === 'blackstone'
        );
      });

      expect(stoneBranch).toBeDefined();
      
      if (stoneBranch) {
        const stoneBranchRoot = stoneBranch.value;
        const stoneVariants = stoneBranchRoot.what?.variants?.map((v: any) => v.value) || [];
        
        expect(stoneVariants).toContain('cobblestone');
        expect(stoneVariants).toContain('cobbled_deepslate');
        expect(stoneVariants).toContain('blackstone');
      }
    });

    it('should create stone_axe craft node with stone variants in children', () => {
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
      
      const stoneBranch = craftNode.children.variants.find((child: any) => {
        const rootNode = child.value;
        if (rootNode.action !== 'root') return false;
        const whatItems = rootNode.what?.variants?.map((v: any) => v.value) || [];
        return whatItems.some((item: string) => 
          item === 'cobblestone' || 
          item === 'cobbled_deepslate' || 
          item === 'blackstone'
        );
      });

      expect(stoneBranch).toBeDefined();
      
      if (stoneBranch) {
        const stoneBranchRoot = stoneBranch.value;
        const stoneVariants = stoneBranchRoot.what?.variants?.map((v: any) => v.value) || [];
        
        expect(stoneVariants).toContain('cobblestone');
        expect(stoneVariants).toContain('cobbled_deepslate');
        expect(stoneVariants).toContain('blackstone');
      }
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
      
      const stoneBranch = craftNode.children.variants.find((child: any) => {
        const rootNode = child.value;
        if (rootNode.action !== 'root') return false;
        const whatItems = rootNode.what?.variants?.map((v: any) => v.value) || [];
        return whatItems.some((item: string) => 
          item === 'cobblestone' || 
          item === 'cobbled_deepslate' || 
          item === 'blackstone'
        );
      });

      expect(stoneBranch).toBeDefined();

      if (stoneBranch) {
        const stoneBranchRoot = stoneBranch.value;
        const stoneVariants = stoneBranchRoot.what?.variants?.map((v: any) => v.value) || [];
        
        expect(stoneVariants.length).toBe(3);
        expect(stoneVariants).toContain('cobblestone');
        expect(stoneVariants).toContain('cobbled_deepslate');
        expect(stoneVariants).toContain('blackstone');
      }
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

  describe('ingredient branch deduplication', () => {
    it('should not duplicate branches for stone material ingredient variants', () => {
      const tree = plan(mcData, 'stone_pickaxe', 1, {
        log: false,
        inventory: new Map([
          ['wooden_pickaxe', 1],
          ['stick', 2],
          ['crafting_table', 1]
        ]),
        combineSimilarNodes: true
      });

      expect(tree).toBeDefined();
      expect(tree.children.variants.length).toBe(1);

      const craftNode = tree.children.variants[0].value as any;
      expect(craftNode.action).toBe('craft');
      
      // When grouping is enabled, we have 3 ingredient variants (one per stone type)
      // to maintain alignment with the 3 result variants for stone_pickaxe.
      // The grouping happens at the children branch level, not the ingredient variant level.
      expect(craftNode.ingredients.variants.length).toBe(3);
      
      // Verify all ingredient variants include both sticks and a stone type
      const stoneTypes = new Set<string>();
      craftNode.ingredients.variants.forEach((variant: any) => {
        const ingredients = variant.value;
        const ingredientItems = ingredients.map((ing: any) => ing.item);
        expect(ingredientItems).toContain('stick');
        
        // Extract stone type from this variant
        const stoneType = ingredientItems.find((item: string) => 
          item === 'cobblestone' || 
          item === 'cobbled_deepslate' || 
          item === 'blackstone'
        );
        if (stoneType) {
          stoneTypes.add(stoneType);
        }
      });
      
      // All 3 stone types should be represented across the ingredient variants
      expect(stoneTypes.size).toBe(3);
      expect(stoneTypes.has('cobblestone')).toBe(true);
      expect(stoneTypes.has('cobbled_deepslate')).toBe(true);
      expect(stoneTypes.has('blackstone')).toBe(true);

      // Key assertion: craft node should have exactly 2 children (stick + stone materials)
      // NOT 3 separate branches for each stone type
      expect(craftNode.children.variants.length).toBe(2);

      // Find the stone materials branch
      const stoneBranch = craftNode.children.variants.find((child: any) => {
        const rootNode = child.value;
        if (rootNode.action !== 'root') return false;
        const whatItems = rootNode.what?.variants?.map((v: any) => v.value) || [];
        return whatItems.includes('cobblestone') || 
               whatItems.includes('blackstone') || 
               whatItems.includes('cobbled_deepslate');
      });

      expect(stoneBranch).toBeDefined();

      if (stoneBranch) {
        // Verify the stone branch has all 3 stone types as variants
        const stoneBranchRoot = stoneBranch.value;
        const stoneVariants = stoneBranchRoot.what?.variants?.map((v: any) => v.value) || [];
        
        expect(stoneVariants).toContain('cobblestone');
        expect(stoneVariants).toContain('blackstone');
        expect(stoneVariants).toContain('cobbled_deepslate');
      }

      // Verify only ONE root node for stone (not 3 separate branches)
      const stoneRootCount = craftNode.children.variants.filter((child: any) => {
        const rootNode = child.value;
        if (rootNode.action !== 'root') return false;
        const whatItems = rootNode.what?.variants?.map((v: any) => v.value) || [];
        return whatItems.some((item: string) => 
          item === 'cobblestone' || 
          item === 'blackstone' || 
          item === 'cobbled_deepslate'
        );
      }).length;

      expect(stoneRootCount).toBe(1);
    });
  });
});

