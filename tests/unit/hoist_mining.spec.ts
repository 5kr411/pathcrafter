import { hoistMiningInPath, hoistMiningInPaths } from '../../path_optimizations/hoistMining';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup, createTestIngredientGroup } from '../testHelpers';

describe('unit: hoist mining optimizer', () => {
    test('merges identical mining steps and sums counts', () => {
        const path: ActionStep[] = [
            createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), count: 1 }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, ingredients: createTestIngredientGroup([{ item: 'oak_log', perCraftCount: 1 }]), result: createTestItemReferenceGroup('oak_planks', 4) }),
            createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), count: 2 }),
            createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, ingredients: createTestIngredientGroup([{ item: 'oak_planks', perCraftCount: 4 }]), result: createTestItemReferenceGroup('crafting_table', 1) }),
            createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), count: 3 })
        ];
        const out = hoistMiningInPath(path);
        const mines = out.filter(s => s.action === 'mine');
        expect(mines.length).toBe(1);
        expect(mines[0].what.variants[0].value).toBe('oak_log');
        expect(mines[0].count).toBe(6);
        // preserves order of non-mining steps
        expect(out[1].action).toBe('craft');
        expect(out[2].action).toBe('craft');
        expect(out.length).toBe(path.length - 2);
    });

    test('separates mining steps by tool key', () => {
        const path: ActionStep[] = [
            createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 1, tool: createTestStringGroup('wooden_pickaxe') }),
            createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 2, tool: createTestStringGroup('stone_pickaxe') }),
            createTestActionStep({ action: 'mine', what: createTestStringGroup('stone'), count: 3, tool: createTestStringGroup('wooden_pickaxe') })
        ];
        const out = hoistMiningInPath(path);
        const wood = out.find(s => s.action === 'mine' && s.tool?.variants[0].value === 'wooden_pickaxe');
        const stone = out.find(s => s.action === 'mine' && s.tool?.variants[0].value === 'stone_pickaxe');
        expect(wood!.count).toBe(4);
        expect(stone!.count).toBe(2);
        expect(out.filter(s => s.action === 'mine').length).toBe(2);
    });

    test('handles targetItem key variant', () => {
        const path: ActionStep[] = [
            createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), targetItem: createTestStringGroup('oak_log'), count: 1 }),
            createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), targetItem: createTestStringGroup('oak_log'), count: 2 })
        ];
        const out = hoistMiningInPath(path);
        expect(out.length).toBe(1);
        expect(out[0].what.variants[0].value).toBe('oak_log');
        expect(out[0].targetItem?.variants[0].value).toBe('oak_log');
        expect(out[0].count).toBe(3);
    });

    test('hoistMiningInPaths maps over path arrays', () => {
        const paths: ActionStep[][] = [
            [ createTestActionStep({ action: 'mine', what: createTestStringGroup('iron_ore'), count: 1 }), createTestActionStep({ action: 'mine', what: createTestStringGroup('iron_ore'), count: 2 }) ],
            [ createTestActionStep({ action: 'mine', what: createTestStringGroup('coal_ore'), count: 1 }) ]
        ];
        const out = hoistMiningInPaths(paths);
        expect(out[0].length).toBe(1);
        expect(out[0][0].count).toBe(3);
        expect(out[1].length).toBe(1);
        expect(out[1][0].what.variants[0].value).toBe('coal_ore');
    });
});

