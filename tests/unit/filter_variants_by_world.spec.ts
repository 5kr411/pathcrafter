import { filterPathVariantsByWorld } from '../../path_filters';
import { ActionPath } from '../../action_tree/types';

describe('unit: filterPathVariantsByWorld', () => {
  
  test('filters mine step variants to only include available blocks', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: ['oak_log', 'spruce_log', 'birch_log', 'jungle_log'],
          targetItemVariants: ['oak_log', 'spruce_log', 'birch_log', 'jungle_log'],
          variantMode: 'one_of'
        }
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
    expect(step.whatVariants).toEqual(['oak_log', 'spruce_log']);
    expect(step.targetItemVariants).toEqual(['oak_log', 'spruce_log']);
    expect(step.variantMode).toBe('one_of');
  });

  test('removes mine step when no variants are available', () => {
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
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: ['oak_log', 'spruce_log', 'birch_log'],
          targetItemVariants: ['oak_log', 'spruce_log', 'birch_log'],
          variantMode: 'one_of'
        }
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
    expect(step.whatVariants).toBeUndefined();
    expect(step.targetItemVariants).toBeUndefined();
    expect(step.variantMode).toBeUndefined();
  });

  test('filters craft step variants based on ingredient availability', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'craft',
          what: 'inventory',
          count: 1,
          result: { item: 'oak_planks', perCraftCount: 4 },
          ingredients: [{ item: 'oak_log', perCraftCount: 1 }],
          resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks'],
          ingredientVariants: [
            ['oak_log'],
            ['spruce_log'],
            ['birch_log']
          ],
          variantMode: 'one_of'
        }
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
    
    // Should only keep variants with available ingredients
    expect(step.resultVariants).toEqual(['oak_planks', 'birch_planks']);
    expect(step.ingredientVariants).toEqual([['oak_log'], ['birch_log']]);
  });

  test('keeps steps without variants unchanged', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'diamond_ore',
          count: 3,
          targetItem: 'diamond',
          tool: 'iron_pickaxe'
        }
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
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log',
          whatVariants: ['oak_log', 'spruce_log'],
          targetItemVariants: ['oak_log', 'spruce_log'],
          variantMode: 'one_of'
        },
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
        spruce_log: { count: 20, closestDistance: 5, averageDistance: 10 }
      }
    };

    const filtered = filterPathVariantsByWorld(paths, snapshot);

    expect(filtered.length).toBe(1);
    expect(filtered[0].length).toBe(2);
    
    // Both steps should be filtered to spruce only
    expect(filtered[0][0].what).toBe('spruce_log');
    expect(filtered[0][1].result?.item).toBe('spruce_planks');
    expect(filtered[0][1].ingredients![0].item).toBe('spruce_log');
  });

  test('handles null/undefined snapshot', () => {
    const paths: ActionPath[] = [
      [
        {
          action: 'mine',
          what: 'oak_log',
          count: 1,
          targetItem: 'oak_log'
        }
      ]
    ];

    const filtered = filterPathVariantsByWorld(paths, null);
    expect(filtered).toEqual(paths); // No filtering when no snapshot

    const filtered2 = filterPathVariantsByWorld(paths, undefined);
    expect(filtered2).toEqual(paths);
  });
});
