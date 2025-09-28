const { _internals, createBehaviorForStep } = require('../../behavior_generator');

describe('unit: behavior_generator mine mapping', () => {
    test('computeTargetsForMine uses targetItem when present', () => {
        const step = { action: 'mine', what: 'stone', targetItem: 'cobblestone', count: 2 };
        const t = _internals.computeTargetsForMine(step);
        expect(t).toEqual({ itemName: 'cobblestone', amount: 2, blockName: 'stone' });
    });

    test('computeTargetsForMine falls back to block name when no targetItem', () => {
        const step = { action: 'mine', what: 'cobblestone', count: 3 };
        const t = _internals.computeTargetsForMine(step);
        expect(t).toEqual({ itemName: 'cobblestone', amount: 3, blockName: 'cobblestone' });
    });

    test('createBehaviorForStep creates behavior for mine leaf step', () => {
        const mcData = require('minecraft-data')('1.20.1');
        const bot = { version: '1.20.1', mcData, inventory: { items: () => [], slots: [], firstEmptyInventorySlot: () => 9 }, world: { getBlockType: () => 0 }, entity: { position: { clone: () => ({}) } } };
        const step = { action: 'mine', what: 'stone', targetItem: 'cobblestone', count: 1 };
        const behavior = createBehaviorForStep(bot, step);
        expect(behavior).toBeTruthy();
        expect(typeof behavior).toBe('object');
    });
});


