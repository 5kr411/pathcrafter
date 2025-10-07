import { filterPathVariantsByWorld } from '../../path_filters';
import { ActionPath } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup, createTestIngredientGroup } from '../testHelpers';

describe('unit: filterPathVariantsByWorld', () => {
  
  test('filters mine step variants to only include available blocks', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('oak_log'),
          count: 1,
          targetItem: createTestStringGroup('oak_log')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: 10, closestDistance: 5, averageDistance: 10 },
        spruce_log: { count: 5, closestDistance: 15, averageDistance: 20 }
        // birch_log and jungle_log not in world
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);

    expect(filtered.length).toBe(1);
    expect(filtered[0].length).toBe(1);
    
    const step = filtered[0][0];
    expect(step.what.variants.map((v: any) => v.value)).toEqual(['oak_log', 'spruce_log']);
    expect(step.targetItem?.variants.map((v: any) => v.value)).toEqual(['oak_log', 'spruce_log']);
    expect(step.variantMode).toBe('one_of');
  });

  test('removes mine step when no variants are available', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('oak_log'),
          count: 1,
          targetItem: createTestStringGroup('oak_log')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        birch_log: { count: 10, closestDistance: 5, averageDistance: 10 }
        // oak_log and spruce_log not available
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);

    expect(filtered.length).toBe(0); // Path filtered out entirely
  });

  test('simplifies to single variant when only one available', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('oak_log'),
          count: 1,
          targetItem: createTestStringGroup('oak_log')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        spruce_log: { count: 10, closestDistance: 5, averageDistance: 10 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);

    expect(filtered.length).toBe(1);
    const step = filtered[0][0];
    
    // Should simplify by removing variant arrays
    expect(step.what).toBe('spruce_log');
    expect(step.targetItem).toBe('spruce_log');
    expect(step.what.variants.length).toBe(1);
    expect(step.targetItem?.variants.length).toBe(1);
    expect(step.variantMode).toBeUndefined();
  });

  test('keeps craft step variants and selects available ingredients', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'craft',
          what: createTestStringGroup('inventory'),
          count: 1,
          result: createTestItemReferenceGroup('oak_planks', 4),
          ingredients: createTestIngredientGroup([{ item: 'oak_log', perCraftCount: 1 }])
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: 10, closestDistance: 5, averageDistance: 10 },
        birch_log: { count: 5, closestDistance: 15, averageDistance: 20 }
        // spruce_log not available
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);

    expect(filtered.length).toBe(1);
    const step = filtered[0][0];
    
    // Craft variants are not filtered - crafting can produce items that aren't directly available
    // Only mining nodes should be filtered based on world availability
    expect(step.result?.variants.map((v: any) => v.value.item)).toEqual(['oak_planks']);
    expect(step.ingredients?.variants[0].value.map((i: any) => i.item)).toEqual(['oak_log']);
    
    // But the primary ingredients should be updated to use available sources
    expect(step.result?.variants[0].value.item).toBe('oak_planks'); // First variant with available source
    expect(step.ingredients?.variants[0].value[0]?.item).toBe('oak_log'); // Corresponding ingredient
  });

  test('keeps steps without variants unchanged', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('diamond_ore'),
          count: 3,
          targetItem: createTestStringGroup('diamond')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        diamond_ore: { count: 5, closestDistance: 50, averageDistance: 100 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);

    expect(filtered.length).toBe(1);
    expect(filtered[0]).toEqual(paths[0]);
  });

  test('handles multiple steps in path', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('oak_log'),
          count: 1,
          targetItem: createTestStringGroup('oak_log')
        }),
        createTestActionStep({
          action: 'craft',
          what: createTestStringGroup('inventory'),
          count: 1,
          result: createTestItemReferenceGroup('oak_planks', 4),
          ingredients: createTestIngredientGroup([{ item: 'oak_log', perCraftCount: 1 }])
        })
      ]
    ];

    const snapshot = {
      blocks: {
        spruce_log: { count: 20, closestDistance: 5, averageDistance: 10 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);

    expect(filtered.length).toBe(1);
    expect(filtered[0].length).toBe(2);
    
    // Both steps should be filtered to spruce only
    expect(filtered[0][0].what.variants[0].value).toBe('spruce_log');
    expect(filtered[0][1].result?.variants[0].value.item).toBe('spruce_planks');
    expect(filtered[0][1].ingredients!.variants[0].value[0].item).toBe('spruce_log');
  });

  test('handles null/undefined snapshot', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('oak_log'),
          count: 1,
          targetItem: createTestStringGroup('oak_log')
        })
      ]
    ];

    const filtered = filterPathVariantsByWorld(paths, null);
    expect(filtered).toEqual(paths); // No filtering when no snapshot

    const filtered2 = filterPathVariantsByWorld(paths, undefined);
    expect(filtered2).toEqual(paths);
  });
});
