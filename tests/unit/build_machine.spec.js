const { buildStateMachineForPath, _internals } = require('../../behavior_generator/buildMachine');

describe('unit: buildStateMachineForPath', () => {
    test('creates sequence for mixed steps', () => {
        const bot = { version: '1.20.1', inventory: { items: () => [], slots: [] }, world: {}, entity: { position: { clone: () => ({}) } } };
        const path = [
            { action: 'mine', what: 'generic_log', targetItem: 'generic_log', count: 3 },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'generic_planks', perCraftCount: 4 }, ingredients: [{ item: 'generic_log', perCraftCount: 1 }] },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'crafting_table', perCraftCount: 1 }, ingredients: [{ item: 'generic_planks', perCraftCount: 4 }] },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'generic_planks', perCraftCount: 4 }, ingredients: [{ item: 'generic_log', perCraftCount: 1 }] },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'stick', perCraftCount: 4 }, ingredients: [{ item: 'generic_planks', perCraftCount: 2 }] },
            { action: 'craft', what: 'inventory', count: 1, result: { item: 'generic_planks', perCraftCount: 4 }, ingredients: [{ item: 'generic_log', perCraftCount: 1 }] },
            { action: 'craft', what: 'table', count: 1, result: { item: 'wooden_pickaxe', perCraftCount: 1 }, ingredients: [{ item: 'generic_planks', perCraftCount: 3 }, { item: 'stick', perCraftCount: 2 }] }
        ];

        const sm = buildStateMachineForPath(bot, path);
        expect(sm).toBeTruthy();
        expect(typeof sm).toBe('object');
    });
});


