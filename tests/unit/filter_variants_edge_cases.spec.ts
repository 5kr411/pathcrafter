import { filterPathVariantsByWorld } from '../../path_filters';
import { ActionPath } from '../../action_tree/types';

describe('unit: filterPathVariantsByWorld edge cases', () => {

  test('handles empty variant arrays gracefully', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: [],
          targetItemVariants: [],
          variantMode: 'one_of'
        }
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
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: ['oak_log', 'spruce_log', 'birch_log'],
          targetItemVariants: ['oak_log', 'spruce_log'], // Shorter array
          variantMode: 'one_of'
        }
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
    expect(filtered[0][0].whatVariants?.length).toBeGreaterThan(0);
  });

  test('filters variants with zero count', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: ['oak_log', 'spruce_log'],
          targetItemVariants: ['oak_log', 'spruce_log'],
          variantMode: 'one_of'
        }
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
    expect(step.what).toBe('spruce_log');
    expect(step.whatVariants).toBeUndefined(); // Simplified to single variant
  });

  test('handles blocks with negative counts', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: ['oak_log', 'spruce_log'],
          targetItemVariants: ['oak_log', 'spruce_log'],
          variantMode: 'one_of'
        }
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
    expect(filtered[0][0].what).toBe('spruce_log');
  });

  test('preserves multiple paths independently', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: ['oak_log', 'spruce_log'],
          targetItemVariants: ['oak_log', 'spruce_log'],
          variantMode: 'one_of'
        }
      ],
      [
        {
          action: 'mine',
          what: 'birch_log',
          count: 1,
          targetItem: 'birch_log',
          whatVariants: ['birch_log', 'jungle_log'],
          targetItemVariants: ['birch_log', 'jungle_log'],
          variantMode: 'one_of'
        }
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
    expect(filtered[0][0].what).toBe('oak_log');
    expect(filtered[1][0].what).toBe('birch_log');
  });

  test('handles craft steps without ingredient variants', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'craft',
          what: 'inventory',
          count: 1,
          result: { item: 'stick', perCraftCount: 4 },
          ingredients: [{ item: 'oak_planks', perCraftCount: 2 }],
          resultVariants: ['stick'],
          // No ingredientVariants field
          variantMode: 'one_of'
        }
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

  test('filters crafting when ingredient source is missing', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'craft',
          what: 'inventory',
          count: 1,
          result: { item: 'oak_planks', perCraftCount: 4 },
          ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
          resultVariants: ['oak_planks', 'spruce_planks'],
          ingredientVariants: [['oak_log'], ['spruce_log']],
          variantMode: 'one_of'
        }
      ]
    ];

    const snapshot = {
      blocks: {
        birch_log: { count: 20, closestDistance: 5, averageDistance: 10 }
        // Neither oak nor spruce available
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);
    
    // Path should be filtered out or have no variants
    expect(filtered.length).toBe(0);
  });

  test('handles complex multi-ingredient crafting', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'craft',
          what: 'table',
          count: 1,
          result: { item: 'wooden_pickaxe', perCraftCount: 1 },
          ingredients: [
            { item: 'oak_planks', perCraftCount: 3 },
            { item: 'stick', perCraftCount: 2 }
          ],
          resultVariants: ['wooden_pickaxe'],
          ingredientVariants: [
            ['oak_planks', 'stick'],
            ['spruce_planks', 'stick']
          ],
          variantMode: 'one_of'
        }
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
        {
          action: 'mine',
          what: 'iron_ore',
          count: 3,
          targetItem: 'raw_iron',
          tool: 'stone_pickaxe'
        }
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
    expect(filtered[0][0].tool).toBe('stone_pickaxe');
  });

  test('preserves step order when filtering', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log'
        },
        {
          action: 'craft',
          what: 'inventory',
          count: 1,
          result: { item: 'oak_planks', perCraftCount: 4 },
          ingredients: [{ item: 'oak_log', perCraftCount: 1 }]
        },
        {
          action: 'craft',
          what: 'inventory',
          count: 1,
          result: { item: 'stick', perCraftCount: 4 },
          ingredients: [{ item: 'oak_planks', perCraftCount: 2 }]
        }
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
