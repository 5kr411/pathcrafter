const { _internals, createBehaviorForStep } = require('../../behavior_generator');

describe('unit: behavior_generator craft-in-table mapping', () => {
    test('computeTargetsForCraftInTable calculates total amount', () => {
        const step = { action: 'craft', what: 'table', count: 2, result: { item: 'wooden_pickaxe', perCraftCount: 1 } };
        const t = _internals.computeTargetsForCraftInTable(step);
        expect(t).toEqual({ itemName: 'wooden_pickaxe', amount: 2 });
    });

    test('createBehaviorForStep returns behavior for craft in table and includes break step hook', () => {
        const mcData = require('minecraft-data')('1.20.1');
        const bot = { version: '1.20.1', mcData, inventory: { items: () => [], slots: [], firstEmptyInventorySlot: () => 9 }, world: { getBlockType: () => 0 }, findBlock: () => null, craft: jest.fn(), entity: { position: { clone: () => ({}) } } };
        const step = { action: 'craft', what: 'table', count: 1, result: { item: 'wooden_pickaxe', perCraftCount: 1 } };
        const behavior = createBehaviorForStep(bot, step);
        expect(behavior).toBeTruthy();
        expect(typeof behavior).toBe('object');
        expect(Array.isArray(behavior.states)).toBe(true);
        expect(behavior.states.length).toBe(3);
        expect(typeof behavior.setBreakPositionFromPlace).toBe('function');
    });
});


