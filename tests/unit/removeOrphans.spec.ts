import { removeOrphanedIngredientsInPath } from '../../path_optimizations/removeOrphans';
import { ActionPath, ActionStep } from '../../action_tree/types';

function createVariantGroup<T>(value: T) {
  return {
    mode: 'one_of' as const,
    variants: [{ value }]
  };
}

describe('removeOrphanedIngredients', () => {
  test('preserves fuel for smelting steps', () => {
    const path: ActionPath = [
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('coal_ore'),
        count: 2,
        targetItem: createVariantGroup('coal'),
        tool: createVariantGroup('wooden_pickaxe')
      } as ActionStep,
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('iron_ore'),
        count: 3,
        targetItem: createVariantGroup('raw_iron'),
        tool: createVariantGroup('stone_pickaxe')
      } as ActionStep,
      {
        action: 'smelt',
        variantMode: 'one_of',
        what: createVariantGroup('furnace'),
        count: 3,
        input: createVariantGroup({ item: 'raw_iron', perSmelt: 1 }),
        result: createVariantGroup({ item: 'iron_ingot', perSmelt: 1 }),
        fuel: createVariantGroup('coal')
      } as ActionStep
    ];

    const result = removeOrphanedIngredientsInPath(path);

    expect(result.length).toBe(3);
    
    const coalMining = result.find(s => s.action === 'mine' && s.targetItem?.variants?.[0]?.value === 'coal');
    expect(coalMining).toBeDefined();
    expect(coalMining!.count).toBeGreaterThan(0);
    
    const ironMining = result.find(s => s.action === 'mine' && 
      s.targetItem?.variants?.[0]?.value === 'raw_iron');
    expect(ironMining).toBeDefined();
    expect(ironMining!.count).toBe(3);
    
    const smeltStep = result.find(s => s.action === 'smelt');
    expect(smeltStep).toBeDefined();
    expect(smeltStep!.count).toBe(3);
  });

  test('preserves crafting table for table crafts', () => {
    const path: ActionPath = [
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('oak_log'),
        count: 1,
        targetItem: createVariantGroup('oak_log'),
        tool: createVariantGroup('hand')
      } as ActionStep,
      {
        action: 'craft',
        variantMode: 'one_of',
        what: createVariantGroup('inventory'),
        count: 1,
        ingredients: createVariantGroup([{ item: 'oak_log', perCraftCount: 4 }]),
        result: createVariantGroup({ item: 'crafting_table', perCraftCount: 1 })
      } as ActionStep,
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('oak_log'),
        count: 3,
        targetItem: createVariantGroup('oak_log'),
        tool: createVariantGroup('hand')
      } as ActionStep,
      {
        action: 'craft',
        variantMode: 'one_of',
        what: createVariantGroup('inventory'),
        count: 1,
        ingredients: createVariantGroup([{ item: 'oak_log', perCraftCount: 1 }]),
        result: createVariantGroup({ item: 'oak_planks', perCraftCount: 4 })
      } as ActionStep,
      {
        action: 'craft',
        variantMode: 'one_of',
        what: createVariantGroup('table'),
        count: 1,
        ingredients: createVariantGroup([
          { item: 'oak_planks', perCraftCount: 3 },
          { item: 'stick', perCraftCount: 2 }
        ]),
        result: createVariantGroup({ item: 'wooden_pickaxe', perCraftCount: 1 })
      } as ActionStep
    ];

    const result = removeOrphanedIngredientsInPath(path);

    const tableCraft = result.find(s => 
      s.action === 'craft' && 
      s.result?.variants?.[0]?.value?.item === 'crafting_table'
    );
    expect(tableCraft).toBeDefined();
  });

  test('preserves tools for mining steps', () => {
    const path: ActionPath = [
      {
        action: 'craft',
        variantMode: 'one_of',
        what: createVariantGroup('table'),
        count: 1,
        ingredients: createVariantGroup([
          { item: 'oak_planks', perCraftCount: 3 },
          { item: 'stick', perCraftCount: 2 }
        ]),
        result: createVariantGroup({ item: 'wooden_pickaxe', perCraftCount: 1 })
      } as ActionStep,
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('stone'),
        count: 3,
        targetItem: createVariantGroup('cobblestone'),
        tool: createVariantGroup('wooden_pickaxe')
      } as ActionStep
    ];

    const result = removeOrphanedIngredientsInPath(path);

    const pickaxeCraft = result.find(s => 
      s.action === 'craft' && 
      s.result?.variants?.[0]?.value?.item === 'wooden_pickaxe'
    );
    expect(pickaxeCraft).toBeDefined();
    
    const miningStep = result.find(s => s.action === 'mine');
    expect(miningStep).toBeDefined();
  });

  test('removes orphaned ingredients after persistent item deduplication', () => {
    const path: ActionPath = [
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('oak_log'),
        count: 8,
        targetItem: createVariantGroup('oak_log'),
        tool: createVariantGroup('hand')
      } as ActionStep,
      {
        action: 'craft',
        variantMode: 'one_of',
        what: createVariantGroup('inventory'),
        count: 8,
        ingredients: createVariantGroup([{ item: 'oak_log', perCraftCount: 1 }]),
        result: createVariantGroup({ item: 'oak_planks', perCraftCount: 4 })
      } as ActionStep,
      {
        action: 'craft',
        variantMode: 'one_of',
        what: createVariantGroup('inventory'),
        count: 4,
        ingredients: createVariantGroup([{ item: 'oak_planks', perCraftCount: 2 }]),
        result: createVariantGroup({ item: 'stick', perCraftCount: 4 })
      } as ActionStep,
      {
        action: 'craft',
        variantMode: 'one_of',
        what: createVariantGroup('table'),
        count: 1,
        ingredients: createVariantGroup([
          { item: 'oak_planks', perCraftCount: 3 },
          { item: 'stick', perCraftCount: 2 }
        ]),
        result: createVariantGroup({ item: 'wooden_pickaxe', perCraftCount: 1 })
      } as ActionStep
    ];

    const result = removeOrphanedIngredientsInPath(path);

    const logMining = result.find(s => s.action === 'mine');
    expect(logMining).toBeDefined();
    expect(logMining!.count).toBeLessThanOrEqual(2);
    
    const plankCraft = result.find(s => 
      s.action === 'craft' && 
      s.result?.variants?.[0]?.value?.item === 'oak_planks'
    );
    expect(plankCraft).toBeDefined();
    expect(plankCraft!.count).toBeLessThanOrEqual(2);
  });

  test('calculates correct fuel demand for multiple smelts', () => {
    const path: ActionPath = [
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('coal_ore'),
        count: 10,
        targetItem: createVariantGroup('coal'),
        tool: createVariantGroup('wooden_pickaxe')
      } as ActionStep,
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('iron_ore'),
        count: 16,
        targetItem: createVariantGroup('raw_iron'),
        tool: createVariantGroup('stone_pickaxe')
      } as ActionStep,
      {
        action: 'smelt',
        variantMode: 'one_of',
        what: createVariantGroup('furnace'),
        count: 16,
        input: createVariantGroup({ item: 'raw_iron', perSmelt: 1 }),
        result: createVariantGroup({ item: 'iron_ingot', perSmelt: 1 }),
        fuel: createVariantGroup('coal')
      } as ActionStep
    ];

    const result = removeOrphanedIngredientsInPath(path);

    const coalMining = result.find(s => s.action === 'mine' && s.targetItem?.variants?.[0]?.value === 'coal');
    expect(coalMining).toBeDefined();
    expect(coalMining!.count).toBeGreaterThanOrEqual(2);
    expect(coalMining!.count).toBeLessThanOrEqual(10);
  });

  test('handles empty path', () => {
    const path: ActionPath = [];
    const result = removeOrphanedIngredientsInPath(path);
    expect(result).toEqual([]);
  });

  test('handles single step path', () => {
    const path: ActionPath = [
      {
        action: 'mine',
        variantMode: 'one_of',
        what: createVariantGroup('oak_log'),
        count: 1,
        targetItem: createVariantGroup('oak_log'),
        tool: createVariantGroup('hand')
      } as ActionStep
    ];

    const result = removeOrphanedIngredientsInPath(path);
    expect(result.length).toBe(1);
    expect(result[0].count).toBe(1);
  });
});

