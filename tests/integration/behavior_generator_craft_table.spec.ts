import { ActionStep } from '../../action_tree/types';
import plan from '../../planner';
import { createBehaviorForStep } from '../../behavior_generator';

describe('integration: behavior_generator craft-in-table', () => {
    const { resolveMcData, enumerateLowestWeightPathsGenerator } = (plan as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('creates behavior for a craft-in-table step from planner path with break step', () => {
        const inventory = { oak_planks: 4, stick: 2 };
        const tree = plan(mcData, 'wooden_pickaxe', 1, { log: false, inventory });
        const [path] = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })) as ActionStep[][];
        expect(path).toBeDefined();
        const craftTableStep = path.find((s: any) => s.action === 'craft' && s.what === 'table' && s.result && s.result.item === 'wooden_pickaxe');
        expect(craftTableStep).toBeDefined();
        const mc = require('minecraft-data')('1.20.1');
        const bot = { 
            version: '1.20.1', 
            mcData: mc, 
            inventory: { 
                items: () => [{ name: 'crafting_table' }], 
                slots: [], 
                firstEmptyInventorySlot: () => 9 
            }, 
            world: { 
                getBlockType: () => 0 
            }, 
            findBlock: () => null, 
            craft: async () => {}, 
            entity: { 
                position: { 
                    clone: () => ({}) 
                } 
            } 
        } as any;
        const behavior = createBehaviorForStep(bot, craftTableStep!);
        expect(behavior).toBeTruthy();
        expect(Array.isArray((behavior as any).states)).toBe(true);
        expect((behavior as any).states.length).toBe(3);
    });
});

