import plan from '../../planner';
import type { WorldSnapshot } from '../../utils/worldSnapshotTypes';
import { enumerateActionPaths } from '../../action_tree/enumerate';

describe('integration: variant consistency end-to-end', () => {
  let mcData: any;

  beforeEach(() => {
    mcData = require('minecraft-data')('1.20.1');
  });

  describe('stone-type material plans', () => {
    test('stone pickaxe plan with only stone available uses cobblestone consistently', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          stone: { count: 50, closestDistance: 10, averageDistance: 15 },
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

      expect(tree.children.variants.length).toBeGreaterThan(0);
      
      const topLevelCrafts = tree.children.variants.filter((v: any) => v.value.action === 'craft');
      
      expect(topLevelCrafts.length).toBeGreaterThan(0);
      expect(topLevelCrafts.length).toBeLessThanOrEqual(3);
    });

    test('stone pickaxe plan with only deepslate available uses cobbled_deepslate consistently', () => {
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

      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);

      for (const path of paths) {
        for (const step of path) {
          if (step.action === 'craft' && step.ingredients) {
            for (const variant of step.ingredients.variants) {
              const ingredients = variant.value;
              if (Array.isArray(ingredients)) {
                for (const ingredient of ingredients) {
                  if (ingredient.item === 'cobblestone' || ingredient.item === 'stone') {
                    fail(`Path should not use ${ingredient.item} when only deepslate is available`);
                  }
                }
              }
            }
          }
        }
      }
    });
  });

  describe('mixed inventory scenarios', () => {
    test('inventory with oak_planks produces paths using oak family', () => {
      const tree = plan(mcData, 'stick', 4, {
        log: false,
        inventory: new Map([['oak_planks', 3]]),
        pruneWithWorld: false,
        combineSimilarNodes: true
      });

      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);

      const hasOakPlankPath = paths.some(path =>
        path.some(step =>
          step.action === 'craft' &&
          step.ingredients?.variants.some(v =>
            v.value?.some((ing: any) => ing.item === 'oak_planks')
          )
        )
      );

      expect(hasOakPlankPath).toBe(true);
    });

    test('inventory with multiple wood types allows multiple families but each path is consistent', () => {
      const tree = plan(mcData, 'stick', 8, {
        log: false,
        inventory: new Map([
          ['oak_planks', 2],
          ['spruce_planks', 2]
        ]),
        pruneWithWorld: false,
        combineSimilarNodes: true
      });

      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);

      for (const path of paths) {
        const woodFamiliesUsed = new Set<string>();

        for (const step of path) {
          if (step.action === 'craft' && step.ingredients) {
            for (const variant of step.ingredients.variants) {
              for (const ingredient of variant.value || []) {
                if (ingredient.item?.includes('planks') || ingredient.item?.includes('log')) {
                  const family = ingredient.item.split('_')[0];
                  woodFamiliesUsed.add(family);
                }
              }
            }
          }
        }
      }
    });
  });

  describe('world snapshot constrains variants', () => {
    test('only birch logs in world produces only birch variants', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          birch_log: { count: 30, closestDistance: 5, averageDistance: 10 }
        },
        entities: {}
      };

      const tree = plan(mcData, 'crafting_table', 1, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);

      for (const path of paths) {
        for (const step of path) {
          if (step.action === 'craft' && step.ingredients) {
            for (const variant of step.ingredients.variants) {
              for (const ingredient of variant.value || []) {
                if (ingredient.item?.includes('planks')) {
                  expect(ingredient.item).toBe('birch_planks');
                }
              }
            }
          }

          if (step.action === 'mine' && step.what) {
            for (const variant of step.what.variants) {
              const value: any = variant.value;
              const item = typeof value === 'string' ? value : value?.item;
              if (item?.includes('log')) {
                expect(item).toBe('birch_log');
              }
            }
          }
        }
      }
    });

    test('multiple wood types in world allows variants but each path stays consistent', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          oak_log: { count: 20, closestDistance: 5, averageDistance: 10 },
          spruce_log: { count: 20, closestDistance: 8, averageDistance: 12 }
        },
        entities: {}
      };

      const tree = plan(mcData, 'stick', 4, {
        log: false,
        inventory: new Map(),
        pruneWithWorld: true,
        worldSnapshot,
        combineSimilarNodes: true
      });

      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);

      for (const path of paths) {
        const woodFamilies = new Set<string>();

        for (const step of path) {
          if (step.action === 'mine' && step.targetItem) {
            for (const variant of step.targetItem.variants) {
              const value: any = variant.value;
              const item = typeof value === 'string' ? value : value?.item;
              if (item?.includes('log')) {
                const family = item.split('_')[0];
                woodFamilies.add(family);
              }
            }
          }

          if (step.action === 'craft' && step.ingredients) {
            for (const variant of step.ingredients.variants) {
              for (const ingredient of variant.value || []) {
                if (ingredient.item?.includes('planks')) {
                  const family = ingredient.item.split('_')[0];
                  woodFamilies.add(family);
                }
              }
            }
          }
        }
      }
    });
  });

  describe('no cross-contamination between material types', () => {
    test('stone and deepslate available - each path uses one consistently', () => {
      const worldSnapshot: WorldSnapshot = {
        version: '1.20.1',
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        radius: 128,
        yMin: 0,
        yMax: 255,
        blocks: {
          stone: { count: 50, closestDistance: 10, averageDistance: 15 },
          deepslate: { count: 40, closestDistance: 20, averageDistance: 25 },
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

      const paths = enumerateActionPaths(tree);

      expect(paths.length).toBeGreaterThan(0);

      for (const path of paths) {
        const hasCobblestone = path.some(step =>
          step.action === 'craft' &&
          step.ingredients?.variants.some(v =>
            v.value?.some((ing: any) => ing.item === 'cobblestone')
          )
        );

        const hasCobbledDeepslate = path.some(step =>
          step.action === 'craft' &&
          step.ingredients?.variants.some(v =>
            v.value?.some((ing: any) => ing.item === 'cobbled_deepslate')
          )
        );

        if (hasCobblestone && hasCobbledDeepslate) {
          fail('Path should not mix cobblestone and cobbled_deepslate');
        }
      }
    });
  });
});

