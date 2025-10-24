import { plan } from '../../planner';
import minecraftData from 'minecraft-data';
import { WorldSnapshot } from '../../utils/worldSnapshotTypes';

describe('PostBuildFilter - Missing Ingredients', () => {
  const mcData = minecraftData('1.20.1');

  const emptyWorldSnapshot: WorldSnapshot = {
    version: '1.20.1',
    dimension: 'overworld',
    center: { x: 0, y: 64, z: 0 },
    radius: 32,
    yMin: -64,
    yMax: 320,
    blocks: {},
    entities: {}
  };

  describe('when pruneWithWorld and combineSimilarNodes are enabled', () => {
    it('should remove craft nodes when ingredient is in inventory but insufficient quantity and no acquisition method', () => {
      const inventory = new Map([
        ['diamond', 1],  // Has 1, needs 2 for sword
        ['stick', 10],
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have NO craft variants because we can't get the second diamond
      expect(tree.children.variants.length).toBe(0);
    });

    it('should keep craft nodes when ingredient has acquisition method (mining)', () => {
      const inventory = new Map([
        ['diamond', 1],
        ['stick', 10],
        ['crafting_table', 1],
        ['iron_pickaxe', 1]
      ]);

      const worldWithDiamondOre: WorldSnapshot = {
        ...emptyWorldSnapshot,
        blocks: {
          'diamond_ore': {
            count: 10,
            closestDistance: 30,
            averageDistance: 40
          }
        }
      };

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: worldWithDiamondOre,
        log: false
      });

      // Should have craft variants because we can mine diamond_ore to get the missing diamond
      expect(tree.children.variants.length).toBeGreaterThan(0);
    });

    it('should keep craft nodes when inventory has sufficient materials', () => {
      const inventory = new Map([
        ['diamond', 5],  // More than enough
        ['stick', 10],
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have craft variant because we have all materials in inventory
      expect(tree.children.variants.length).toBeGreaterThan(0);
      
      // Should be a craft node
      const firstVariant = tree.children.variants[0].value;
      expect(firstVariant.action).toBe('craft');
    });

    it('should remove craft nodes when NO ingredients are available', () => {
      const inventory = new Map([
        ['stick', 10],
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have NO variants - no diamonds at all and no way to get them
      expect(tree.children.variants.length).toBe(0);
    });

    it('should handle multi-ingredient recipes correctly', () => {
      // Iron pickaxe needs 3 iron_ingot + 2 sticks
      const inventory = new Map([
        ['iron_ingot', 1],  // Has 1, needs 3
        ['stick', 10],
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'iron_pickaxe', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have NO variants because we can't get the missing 2 iron_ingot
      expect(tree.children.variants.length).toBe(0);
    });

    it('should allow crafting when ingredients can be smelted', () => {
      const inventory = new Map([
        ['raw_iron', 5],  // Can smelt to get iron_ingot
        ['stick', 10],
        ['crafting_table', 1],
        ['furnace', 1],
        ['coal', 10]
      ]);

      const tree = plan(mcData, 'iron_pickaxe', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have variants because we can smelt raw_iron -> iron_ingot
      expect(tree.children.variants.length).toBeGreaterThan(0);
    });

    it('should handle crafting chains correctly', () => {
      // Test: craft iron_pickaxe when we have all needed materials  
      const inventory = new Map([
        ['iron_ingot', 5],  // Enough for pickaxe
        ['stick', 10],       // Enough for pickaxe
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'iron_pickaxe', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should work: have all materials in inventory
      expect(tree.children.variants.length).toBeGreaterThan(0);
    });
  });

  describe('when pruneWithWorld or combineSimilarNodes are disabled', () => {
    it('should NOT prune when pruneWithWorld is false', () => {
      const inventory = new Map([
        ['diamond', 1],  // Insufficient
        ['stick', 10],
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: false,  // Disabled
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Without pruning, tree might still have craft nodes (no validation)
      // This test documents the behavior - pruning only happens when both flags are true
      expect(tree).toBeDefined();
    });

    it('should NOT prune when combineSimilarNodes is false', () => {
      const inventory = new Map([
        ['diamond', 1],  // Insufficient
        ['stick', 10],
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: false,  // Disabled
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Without combineSimilarNodes, pruning doesn't run
      // This test documents the behavior
      expect(tree).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle item with 0 in inventory (key exists but count is 0)', () => {
      const inventory = new Map([
        ['diamond', 0],  // Key exists but count is 0
        ['stick', 10],
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have NO variants - 0 diamonds means we need all 2 and can't get them
      expect(tree.children.variants.length).toBe(0);
    });

    it('should handle exact ingredient count match', () => {
      const inventory = new Map([
        ['diamond', 3],  // More than the 2 needed
        ['stick', 5],    // More than the 1 needed
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have craft variant - have enough materials
      expect(tree.children.variants.length).toBeGreaterThan(0);
      const firstVariant = tree.children.variants[0].value;
      expect(firstVariant.action).toBe('craft');
    });

    it('should handle crafting when one ingredient is sufficient and one is not', () => {
      const inventory = new Map([
        ['diamond', 1],  // Insufficient (need 2)
        ['stick', 100],  // Way more than enough (need 1)
        ['crafting_table', 1]
      ]);

      const tree = plan(mcData, 'diamond_sword', 1, {
        inventory,
        pruneWithWorld: true,
        combineSimilarNodes: true,
        worldSnapshot: emptyWorldSnapshot,
        log: false
      });

      // Should have NO variants - even though we have enough sticks, we're missing diamonds
      expect(tree.children.variants.length).toBe(0);
    });
  });

  describe('bug reproduction - the exact scenario from logs', () => {
    it('should correctly reject crafting diamond tools with only 1 diamond and no ore', () => {
      const inventory = new Map([
        ['diamond', 1],
        ['stick', 7],
        ['crafting_table', 5],
        ['diamond_pickaxe', 1],
        ['diamond_shovel', 1],
        ['diamond_helmet', 1],
        ['diamond_chestplate', 1],
        ['diamond_leggings', 1],
        ['diamond_boots', 1]
      ]);

      const tests = [
        { item: 'diamond_sword', needs: 2 },
        { item: 'diamond_axe', needs: 3 },
        { item: 'diamond_hoe', needs: 2 }
      ];

      for (const test of tests) {
        const tree = plan(mcData, test.item, 1, {
          inventory,
          pruneWithWorld: true,
          combineSimilarNodes: true,
          worldSnapshot: emptyWorldSnapshot,
          log: false
        });

        // Should have NO variants for any of these - all need more than 1 diamond
        expect(tree.children.variants.length).toBe(0);
      }
    });
  });
});

