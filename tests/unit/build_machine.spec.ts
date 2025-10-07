import { buildStateMachineForPath, _internals } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup, createTestIngredientGroup } from '../testHelpers';

describe('unit: buildStateMachineForPath', () => {
    test('creates sequence for mixed steps', () => {
        const bot = { 
            version: '1.20.1', 
            inventory: { 
                items: () => [], 
                slots: [] 
            }, 
            world: {}, 
            entity: { 
                position: { 
                    clone: () => ({}) 
                } 
            } 
        } as any;
        const path: ActionStep[] = [
            createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), targetItem: createTestStringGroup('oak_log'), count: 3 }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4), ingredients: createTestIngredientGroup([{ item: 'oak_log', perCraftCount: 1 }]) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('crafting_table', 1), ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 4 }]) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4), ingredients: createTestIngredientGroup([{ item: 'oak_log', perCraftCount: 1 }]) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('stick', 4), ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 2 }]) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4), ingredients: createTestIngredientGroup([{ item: 'oak_log', perCraftCount: 1 }]) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('table'), count: 1, result: createTestItemReferenceGroup('wooden_pickaxe', 1), ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 3 }, { item: 'stick', perCraftCount: 2 }]) })
        ];

        const sm = buildStateMachineForPath(bot, path);
        expect(sm).toBeTruthy();
        expect(typeof sm).toBe('object');
    });
});

