import { ActionStep } from '../../action_tree/types';
import plan from '../../planner';
import { createBehaviorForStep } from '../../behavior_generator';

describe('integration: behavior_generator craft-in-inventory', () => {
    const { resolveMcData, enumerateLowestWeightPathsGenerator } = (plan as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('creates behavior for a craft-in-inventory step from planner path', () => {
        const inventory = new Map([["oak_log", 1]]);
        const tree = plan(mcData, 'stick', 4, { log: false, inventory });
        const [path] = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })) as ActionStep[][];
        expect(path).toBeDefined();
        const craftInv = path.find((s: any) => s.action === 'craft' && s.what.variants[0].value === 'inventory' && s.result && s.result.variants[0].value.item === 'stick');
        expect(craftInv).toBeDefined();
        // Minimal bot stub to construct behavior
        const bot = { 
            version: '1.20.1', 
            inventory: { 
                slots: [], 
                firstEmptyInventorySlot: () => 9 
            }, 
            craft: async () => {}, 
            moveSlotItem: async () => {} 
        } as any;
        const behavior = createBehaviorForStep(bot, craftInv!);
        expect(behavior).toBeTruthy();
    });
});

