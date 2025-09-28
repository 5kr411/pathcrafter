const { createBehaviorForStep, _internals } = require('../../behavior_generator');

describe('unit: behavior_generator craft-in-inventory mapping', () => {
    test('computeTargetsForCraftInInventory calculates total amount', () => {
        const step = {
            action: 'craft',
            what: 'inventory',
            count: 3,
            result: { item: 'stick', perCraftCount: 4 }
        };
        const t = _internals.computeTargetsForCraftInInventory(step);
        expect(t).toEqual({ itemName: 'stick', amount: 12 });
    });

    test('createBehaviorForStep returns null for unsupported action', () => {
        const bot = {};
        const behavior = createBehaviorForStep(bot, { action: 'mine', what: 'stone', count: 1 });
        expect(behavior).toBeNull();
    });

    test('createBehaviorForStep creates behavior for craft in inventory', () => {
        const bot = { version: '1.20.1', recipesFor: () => [], inventory: { slots: [], firstEmptyInventorySlot: () => 9 }, craft: jest.fn() };
        const step = { action: 'craft', what: 'inventory', count: 1, result: { item: 'stick', perCraftCount: 4 } };
        const behavior = createBehaviorForStep(bot, step);
        expect(behavior).toBeTruthy();
        // The exact class is a NestedStateMachine; we just ensure it's an object
        expect(typeof behavior).toBe('object');
    });
});


