import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';

describe('integration: buildStateMachineForPath hardcoded path', () => {
    test('sm builds without crashing for multi-step path', () => {
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
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('crafting_table', 1) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('stick', 4) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4) }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('table'), count: 1, result: createTestItemReferenceGroup('wooden_pickaxe', 1) })
        ];
        const sm = buildStateMachineForPath(bot, path);
        expect(sm).toBeTruthy();
    });
});

