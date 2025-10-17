import { dedupePersistentItemsInPath, dedupePersistentItemsInPaths } from '../../path_optimizations/dedupePersistentItems';
import { ActionStep } from '../../action_tree/types';
import { 
  createTestActionStep, 
  createTestStringGroup, 
  createTestItemReferenceGroup, 
  createTestIngredientGroup 
} from '../testHelpers';

describe('unit: dedupe persistent items optimizer', () => {
  describe('dedupePersistentItemsInPath', () => {
    test('removes duplicate crafting_table crafts', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'mine', 
          what: createTestStringGroup('oak_log'), 
          count: 1 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 4 }]), 
          result: createTestItemReferenceGroup('crafting_table', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 3 }]), 
          result: createTestItemReferenceGroup('wooden_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 4 }]), 
          result: createTestItemReferenceGroup('crafting_table', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          ingredients: createTestIngredientGroup([{ item: 'cobblestone', perCraftCount: 8 }]), 
          result: createTestItemReferenceGroup('furnace', 1) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      // Should have removed one crafting_table craft
      expect(optimized.length).toBe(4);
      
      // Count crafting_table crafts
      const tableCrafts = optimized.filter(s => 
        s.action === 'craft' && 
        s.result?.variants[0]?.value?.item === 'crafting_table'
      );
      expect(tableCrafts.length).toBe(1);
      
      // First table should remain
      expect(optimized[1].result?.variants[0]?.value?.item).toBe('crafting_table');
    });

    test('removes duplicate wooden_pickaxe crafts', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('wooden_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'mine', 
          what: createTestStringGroup('stone'), 
          count: 8 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('wooden_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'mine', 
          what: createTestStringGroup('coal_ore'), 
          count: 1 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      expect(optimized.length).toBe(3);
      
      const pickaxeCrafts = optimized.filter(s => 
        s.action === 'craft' && 
        s.result?.variants[0]?.value?.item === 'wooden_pickaxe'
      );
      expect(pickaxeCrafts.length).toBe(1);
    });

    test('removes duplicate furnace crafts', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('furnace', 1) 
        }),
        createTestActionStep({ 
          action: 'smelt', 
          what: createTestStringGroup('furnace'), 
          count: 3 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('furnace', 1) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      expect(optimized.length).toBe(2);
      expect(optimized[0].result?.variants[0]?.value?.item).toBe('furnace');
      expect(optimized[1].action).toBe('smelt');
    });

    test('reduces count to 1 for persistent items', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 5, 
          result: createTestItemReferenceGroup('crafting_table', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('stick', 4) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      expect(optimized.length).toBe(2);
      expect(optimized[0].count).toBe(1);
    });

    test('handles multiple different persistent items', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('crafting_table', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('wooden_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('furnace', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('crafting_table', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('wooden_pickaxe', 1) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      expect(optimized.length).toBe(3);
      expect(optimized[0].result?.variants[0]?.value?.item).toBe('crafting_table');
      expect(optimized[1].result?.variants[0]?.value?.item).toBe('wooden_pickaxe');
      expect(optimized[2].result?.variants[0]?.value?.item).toBe('furnace');
    });

    test('preserves non-persistent item crafts', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('oak_planks', 4) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('crafting_table', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('oak_planks', 4) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('stick', 4) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      // All planks and stick crafts should remain, only table dedupe
      expect(optimized.length).toBe(4);
      
      const planksCrafts = optimized.filter(s => 
        s.action === 'craft' && 
        s.result?.variants[0]?.value?.item === 'oak_planks'
      );
      expect(planksCrafts.length).toBe(2);
    });

    test('preserves mine and smelt actions', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'mine', 
          what: createTestStringGroup('oak_log'), 
          count: 5 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('crafting_table', 1) 
        }),
        createTestActionStep({ 
          action: 'mine', 
          what: createTestStringGroup('iron_ore'), 
          count: 3 
        }),
        createTestActionStep({ 
          action: 'smelt', 
          what: createTestStringGroup('furnace'), 
          count: 3 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      expect(optimized.length).toBe(4);
      expect(optimized[0].action).toBe('mine');
      expect(optimized[2].action).toBe('mine');
      expect(optimized[3].action).toBe('smelt');
    });

    test('handles empty path', () => {
      const path: ActionStep[] = [];
      const optimized = dedupePersistentItemsInPath(path);
      expect(optimized).toEqual([]);
    });

    test('handles path with no persistent items', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'mine', 
          what: createTestStringGroup('oak_log'), 
          count: 1 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('oak_planks', 4) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestItemReferenceGroup('stick', 4) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      expect(optimized.length).toBe(3);
      expect(optimized).toEqual(path);
    });

    test('handles all tool tiers', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('wooden_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('stone_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('iron_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('stone_pickaxe', 1) 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('diamond_pickaxe', 1) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      
      // Should remove duplicate stone_pickaxe
      expect(optimized.length).toBe(4);
      
      const stonePickaxes = optimized.filter(s => 
        s.result?.variants[0]?.value?.item === 'stone_pickaxe'
      );
      expect(stonePickaxes.length).toBe(1);
    });
  });

  describe('dedupePersistentItemsInPaths', () => {
    test('applies optimization to multiple paths', () => {
      const paths: ActionStep[][] = [
        [
          createTestActionStep({ 
            action: 'craft', 
            what: createTestStringGroup('inventory'), 
            count: 1, 
            result: createTestItemReferenceGroup('crafting_table', 1) 
          }),
          createTestActionStep({ 
            action: 'craft', 
            what: createTestStringGroup('inventory'), 
            count: 1, 
            result: createTestItemReferenceGroup('crafting_table', 1) 
          })
        ],
        [
          createTestActionStep({ 
            action: 'craft', 
            what: createTestStringGroup('table'), 
            count: 1, 
            result: createTestItemReferenceGroup('furnace', 1) 
          }),
          createTestActionStep({ 
            action: 'craft', 
            what: createTestStringGroup('table'), 
            count: 1, 
            result: createTestItemReferenceGroup('furnace', 1) 
          })
        ]
      ];

      const optimized = dedupePersistentItemsInPaths(paths);
      
      expect(optimized.length).toBe(2);
      expect(optimized[0].length).toBe(1);
      expect(optimized[1].length).toBe(1);
    });

    test('handles empty array', () => {
      const paths: ActionStep[][] = [];
      const optimized = dedupePersistentItemsInPaths(paths);
      expect(optimized).toEqual([]);
    });

    test('handles array with empty paths', () => {
      const paths: ActionStep[][] = [[], []];
      const optimized = dedupePersistentItemsInPaths(paths);
      expect(optimized.length).toBe(2);
      expect(optimized[0]).toEqual([]);
      expect(optimized[1]).toEqual([]);
    });
  });

  describe('edge cases', () => {
    test('handles craft step with string result instead of ItemReference', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestStringGroup('crafting_table') as any
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1, 
          result: createTestStringGroup('crafting_table') as any
        })
      ];

      // Should handle gracefully
      const optimized = dedupePersistentItemsInPath(path);
      expect(optimized.length).toBeLessThanOrEqual(2);
    });

    test('handles craft step with missing result', () => {
      const path: ActionStep[] = [
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('inventory'), 
          count: 1 
        }),
        createTestActionStep({ 
          action: 'craft', 
          what: createTestStringGroup('table'), 
          count: 1, 
          result: createTestItemReferenceGroup('wooden_pickaxe', 1) 
        })
      ];

      const optimized = dedupePersistentItemsInPath(path);
      expect(optimized.length).toBe(2);
    });
  });
});

