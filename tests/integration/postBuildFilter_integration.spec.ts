import plan from '../../planner';
import type { WorldSnapshot } from '../../utils/worldSnapshotTypes';
import { getCachedMcData } from '../testHelpers';

describe('integration: post-build filtering and pruning', () => {
  let ctx: any;

  beforeAll(() => {
    ctx = getCachedMcData('1.20.1');
  });

  describe('dead branch pruning', () => {
    test('empty world produces empty tree', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {},
        entities: {}
      };

      const tree = plan(ctx, 'stick', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      // With no blocks or entities, tree should have no viable children
      expect(tree.children.variants.length).toBe(0);
    });

    test('filters ingredients based on world availability', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          birch_log: {
            count: 10,
            closestDistance: 10,
            averageDistance: 10
          }
        },
        entities: {}
      };

      const tree = plan(ctx, 'stick', 2, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      // Find craft nodes
      const craftVariants = tree.children.variants.filter(
        (v: any) => v.value.action === 'craft'
      );
      
      // If there are craft nodes that make sticks from planks, 
      // they should only use birch variants
      for (const variant of craftVariants) {
        const craftNode = variant.value as any;
        if (craftNode.ingredients && craftNode.ingredients.variants) {
          for (const ingredientVariant of craftNode.ingredients.variants) {
            for (const ingredient of ingredientVariant.value) {
              if (ingredient.item && ingredient.item.includes('planks')) {
                // Should only reference birch_planks, not oak/spruce/etc
                expect(['birch_planks']).toContain(ingredient.item);
              }
            }
          }
        }
      }
    });

    test('keeps only viable wood variants based on world', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          spruce_log: {
            count: 20,
            closestDistance: 10,
            averageDistance: 10
          }
        },
        entities: {}
      };

      const tree = plan(ctx, 'stick', 4, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      // Should have viable children (spruce planks path and maybe dead_bush)
      expect(tree.children.variants.length).toBeGreaterThan(0);

      // Check that spruce craft path exists
      const craftVariants = tree.children.variants.filter(
        (v: any) => v.value.action === 'craft'
      );

      if (craftVariants.length > 0) {
        const craftNode = craftVariants[0].value;
        
        // Craft should use spruce_planks, not oak/birch/etc
        const craftNodeAny = craftNode as any;
        const ingredients = craftNodeAny.ingredients.variants[0].value;
        const plankIngredient = ingredients.find((ing: any) => 
          ing.item.includes('planks')
        );
        
        if (plankIngredient) {
          expect(plankIngredient.item).toBe('spruce_planks');
        }
      }
    });

    test('prunes crimson and warped plank variants when not in world', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          spruce_log: {
            count: 20,
            closestDistance: 10,
            averageDistance: 10
          },
          dead_bush: {
            count: 5,
            closestDistance: 15,
            averageDistance: 15
          }
        },
        entities: {}
      };

      const tree = plan(ctx, 'wooden_pickaxe', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      // Traverse tree to find all craft nodes
      function findAllCraftNodes(node: any, crafts: any[] = []): any[] {
        if (!node) return crafts;
        
        if (node.action === 'craft') {
          crafts.push(node);
        }
        
        if (node.children && node.children.variants) {
          for (const child of node.children.variants) {
            findAllCraftNodes(child.value, crafts);
          }
        }
        
        return crafts;
      }

      const allCraftNodes = findAllCraftNodes(tree);

      // Check that none of the craft nodes produce crimson or warped planks
      for (const craftNode of allCraftNodes) {
        if (craftNode.result && craftNode.result.variants) {
          for (const variant of craftNode.result.variants) {
            const item = variant.value?.item || variant.value;
            expect(item).not.toBe('crimson_planks');
            expect(item).not.toBe('warped_planks');
          }
        }
      }
    });
  });

  describe('convergence behavior', () => {
    test('filters through multiple levels of crafting', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          birch_log: {
            count: 10,
            closestDistance: 10,
            averageDistance: 10
          }
        },
        entities: {}
      };

      const tree = plan(ctx, 'crafting_table', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      expect(tree.children.variants.length).toBeGreaterThan(0);

      // Find the craft node for crafting_table
      const craftNode = tree.children.variants.find(
        (v: any) => v.value.action === 'craft'
      )?.value;

      if (craftNode) {
        // Should only have birch_planks ingredient, not oak/spruce
        const craftNodeAny = craftNode as any;
        const ingredients = craftNodeAny.ingredients.variants[0].value;
        const plankIngredient = ingredients.find((ing: any) => 
          ing.item.includes('planks')
        );
        
        if (plankIngredient) {
          expect(plankIngredient.item).toBe('birch_planks');
        }
      }
    });

    test('handles stick crafting with multiple plank sources', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          oak_log: {
            count: 5,
            closestDistance: 10,
            averageDistance: 10
          },
          spruce_log: {
            count: 5,
            closestDistance: 20,
            averageDistance: 20
          }
        },
        entities: {}
      };

      const tree = plan(ctx, 'stick', 4, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      const craftVariants = tree.children.variants.filter(
        (v: any) => v.value.action === 'craft'
      );

      if (craftVariants.length > 0) {
        const craftNode = craftVariants[0].value as any;
        
        // Should have multiple ingredient variants (oak and spruce planks)
        expect(craftNode.ingredients.variants.length).toBeGreaterThanOrEqual(1);
        
        // But should NOT have crimson, warped, bamboo, etc
        for (const variant of craftNode.ingredients.variants) {
          for (const ingredient of variant.value) {
            if (ingredient.item.includes('planks')) {
              expect(['oak_planks', 'spruce_planks']).toContain(ingredient.item);
            }
          }
        }
      }
    });
  });

  describe('integration with path enumeration', () => {
    test('enumerated paths only use filtered variants', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          acacia_log: {
            count: 15,
            closestDistance: 10,
            averageDistance: 10
          }
        },
        entities: {}
      };

      const tree = plan(ctx, 'stick', 2, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      const { enumerateActionPaths } = require('../../action_tree/enumerate');
      const paths = enumerateActionPaths(tree, { inventory: new Map() });

      expect(paths.length).toBeGreaterThan(0);

      // All paths should only use acacia wood variants
      for (const path of paths) {
        for (const step of path) {
          if (step.action === 'craft' && step.ingredients) {
            for (const variant of step.ingredients.variants) {
              for (const ingredient of variant.value) {
                if (ingredient.item.includes('planks')) {
                  expect(ingredient.item).toBe('acacia_planks');
                }
                if (ingredient.item.includes('log')) {
                  expect(ingredient.item).toBe('acacia_log');
                }
              }
            }
          }
          
          if (step.action === 'mine' && step.what) {
            for (const variant of step.what.variants) {
              const item = variant.value;
              if (typeof item === 'string' && item.includes('log')) {
                expect(item).toBe('acacia_log');
              }
            }
          }
        }
      }
    });

    test('empty world produces zero or very few paths', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {},
        entities: {}
      };

      const tree = plan(ctx, 'stick', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      const { enumerateActionPaths } = require('../../action_tree/enumerate');
      const paths = enumerateActionPaths(tree, { inventory: new Map() });

      // Tree should be mostly empty with no viable resources
      expect(tree.children.variants.length).toBeLessThanOrEqual(1);
      
      // Paths should be very limited or zero
      expect(paths.length).toBeLessThanOrEqual(1);
    });
  });

  describe('does not affect trees when disabled', () => {
    test('tree without pruneWithWorld has all variants', () => {
      const tree = plan(ctx, 'stick', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: false,
        combineSimilarNodes: true
      });

      const craftVariants = tree.children.variants.filter(
        (v: any) => v.value.action === 'craft'
      );

      if (craftVariants.length > 0) {
        const craftNode = craftVariants[0].value as any;
        
        // Should have many plank variants (oak, spruce, birch, jungle, acacia, dark_oak, etc)
        expect(craftNode.ingredients.variants.length).toBeGreaterThan(5);
      }
    });

    test('tree without combineSimilarNodes is not filtered', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          spruce_log: {
            count: 10,
            closestDistance: 10,
            averageDistance: 10
          }
        },
        entities: {}
      };

      const tree = plan(ctx, 'stick', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: false
      });

      // Without combineSimilarNodes, variants shouldn't be combined/filtered
      // Tree structure will be different (no combined variants)
      expect(tree.children.variants.length).toBeGreaterThan(0);
    });
  });
});

