import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';

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
            { action: 'mine', what: 'oak_log', targetItem: 'oak_log', count: 3 },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'oak_planks', perCraftCount: 4 } },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'crafting_table', perCraftCount: 1 } },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'oak_planks', perCraftCount: 4 } },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'stick', perCraftCount: 4 } },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'oak_planks', perCraftCount: 4 } },
            { action: 'craft', what: 'table', count: 1, result: { item: 'wooden_pickaxe', perCraftCount: 1 } }
        ];
        const sm = buildStateMachineForPath(bot, path);
        expect(sm).toBeTruthy();
    });
});

