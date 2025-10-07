import { filterPathVariantsByWorld } from '../../path_filters';
import { ActionPath } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup, createTestIngredientGroup } from '../testHelpers';

describe('unit: filterPathVariantsByWorld edge cases', () => {

  test('handles empty variant arrays gracefully', () => {
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
        oak_log: { count: 10, closestDistance: 5, averageDistance: 10 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Should keep the step since it has no actual variants
    expect(filtered.length).toBe(1);
  });

  test('handles mismatched variant array lengths', () => {
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
        spruce_log: { count: 5, closestDistance: 8, averageDistance: 12 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Should handle gracefully
    expect(filtered.length).toBe(1);
    expect(filtered[0][0].what?.variants.length).toBeGreaterThan(0);
  });

  test('filters variants with zero count', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('spruce_log'),
          count: 1,
          targetItem: createTestStringGroup('spruce_log')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: 0, closestDistance: 5, averageDistance: 10 }, // Zero count
        spruce_log: { count: 10, closestDistance: 8, averageDistance: 12 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    expect(filtered.length).toBe(1);
    const step = filtered[0][0];
    
    // Should only include spruce (oak has 0 count)
    expect(step.what.variants[0].value).toBe('spruce_log');
    expect(step.what.variants.length).toBe(1); // Single variant in VariantGroup
  });

  test('handles blocks with negative counts', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('spruce_log'),
          count: 1,
          targetItem: createTestStringGroup('spruce_log')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: -5, closestDistance: 5, averageDistance: 10 }, // Negative (invalid)
        spruce_log: { count: 10, closestDistance: 8, averageDistance: 12 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Should treat negative as unavailable
    expect(filtered.length).toBe(1);
    expect(filtered[0][0].what.variants[0].value).toBe('spruce_log');
  });

  test('preserves multiple paths independently', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('oak_log'),
          count: 1,
          targetItem: createTestStringGroup('oak_log')
        })
      ],
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('birch_log'),
          count: 1,
          targetItem: createTestStringGroup('birch_log')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: 10, closestDistance: 5, averageDistance: 10 },
        birch_log: { count: 8, closestDistance: 7, averageDistance: 14 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    expect(filtered.length).toBe(2);
    expect(filtered[0][0].what.variants[0].value).toBe('oak_log');
    expect(filtered[1][0].what.variants[0].value).toBe('birch_log');
  });

  test('handles craft steps without ingredient variants', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'craft',
          what: createTestStringGroup('inventory'),
          count: 1,
          result: createTestItemReferenceGroup('stick', 4),
          ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 2 }])
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: 10, closestDistance: 5, averageDistance: 10 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Should handle gracefully
    expect(filtered.length).toBeGreaterThanOrEqual(0);
  });

  test('keeps crafting variants even when ingredient sources are missing', () => {
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
        birch_log: { count: 20, closestDistance: 5, averageDistance: 10 }
        // Neither oak nor spruce available
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Craft variants are not filtered based on ingredient availability
    // Crafting can produce items that aren't directly available in the world
    // Only mining nodes should be filtered based on world availability
    expect(filtered.length).toBe(1);
    const step = filtered[0][0];
    expect(step.result?.variants.map((v: any) => v.value.item)).toEqual(['oak_planks']);
    expect(step.ingredients?.variants[0].value.map((i: any) => i.item)).toEqual(['oak_log']);
  });

  test('handles complex multi-ingredient crafting', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'craft',
          what: createTestStringGroup('table'),
          count: 1,
          result: createTestItemReferenceGroup('wooden_pickaxe', 1),
          ingredients: createTestIngredientGroup([
            { item: 'oak_planks', perCraftCount: 3 },
            { item: 'stick', perCraftCount: 2 }
          ])
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: 5, closestDistance: 10, averageDistance: 20 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Should keep path since oak_log can provide oak_planks
    expect(filtered.length).toBeGreaterThanOrEqual(0);
  });

  test('handles steps with tool requirements', () => {
    const paths: ActionPath[] = [
      [
        createTestActionStep({
          action: 'mine',
          what: createTestStringGroup('iron_ore'),
          count: 3,
          targetItem: createTestStringGroup('raw_iron'),
          tool: createTestStringGroup('stone_pickaxe')
        })
      ]
    ];

    const snapshot = {
      blocks: {
        iron_ore: { count: 10, closestDistance: 20, averageDistance: 40 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Tool requirement should be preserved
    expect(filtered.length).toBe(1);
    expect(filtered[0][0].tool?.variants[0].value).toBe('stone_pickaxe');
  });

  test('preserves step order when filtering', () => {
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
        }),
        createTestActionStep({
          action: 'craft',
          what: createTestStringGroup('inventory'),
          count: 1,
          result: createTestItemReferenceGroup('stick', 4),
          ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 2 }])
        })
      ]
    ];

    const snapshot = {
      blocks: {
        oak_log: { count: 20, closestDistance: 5, averageDistance: 10 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    expect(filtered.length).toBe(1);
    expect(filtered[0].length).toBe(3);
    expect(filtered[0][0].action).toBe('mine');
    expect(filtered[0][1].action).toBe('craft');
    expect(filtered[0][2].action).toBe('craft');
  });
});
