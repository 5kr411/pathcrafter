import { createBehaviorForStep, _internals } from '../../behavior_generator';

describe('unit: behavior_generator craft-in-inventory mapping', () => {
    test('computeTargetsForCraftInInventory calculates total amount', () => {
        const step = {
            action: 'craft' as const,
            what: 'inventory',
            count: 3,
            result: { item: 'stick', perCraftCount: 4 }
        };
        const t = _internals.computeTargetsForCraftInInventory(step);
        expect(t).toEqual({ itemName: 'stick', amount: 12 });
    });

    test('createBehaviorForStep returns null for unsupported action', () => {
        const bot = {} as any;
        const behavior = createBehaviorForStep(bot, { action: 'teleport' as any, what: 'nowhere', count: 1 });
        expect(behavior).toBeNull();
    });

    test('createBehaviorForStep creates behavior for craft in inventory', () => {
        const bot = { 
            version: '1.20.1', 
            recipesFor: () => [], 
            inventory: { 
                slots: [], 
                firstEmptyInventorySlot: () => 9 
            }, 
            craft: jest.fn() 
        } as any;
        const step = { action: 'craft' as const, what: 'inventory', count: 1, result: { item: 'stick', perCraftCount: 4 } };
        const behavior = createBehaviorForStep(bot, step);
        expect(behavior).toBeTruthy();
        // The exact class is a NestedStateMachine; we just ensure it's an object
        expect(typeof behavior).toBe('object');
    });
});

