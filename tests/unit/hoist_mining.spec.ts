import { hoistMiningInPath, hoistMiningInPaths } from '../../path_optimizations/hoistMining';
import { ActionStep } from '../../action_tree/types';

describe('unit: hoist mining optimizer', () => {
    test('merges identical mining steps and sums counts', () => {
        const path: ActionStep[] = [
            { action: 'mine', what: 'oak_log', count: 1 },
            { action: 'craft', what: 'inventory', count: 1, ingredients: [{ item: 'oak_log', perCraftCount: 1 }], result: { item: 'oak_planks', perCraftCount: 4 } },
            { action: 'mine', what: 'oak_log', count: 2 },
            { action: 'craft', what: 'inventory', count: 1, ingredients: [{ item: 'oak_planks', perCraftCount: 4 }], result: { item: 'crafting_table', perCraftCount: 1 } },
            { action: 'mine', what: 'oak_log', count: 3 }
        ];
        const out = hoistMiningInPath(path);
        const mines = out.filter(s => s.action === 'mine');
        expect(mines.length).toBe(1);
        expect(mines[0].what).toBe('oak_log');
        expect(mines[0].count).toBe(6);
        // preserves order of non-mining steps
        expect(out[1].action).toBe('craft');
        expect(out[2].action).toBe('craft');
        expect(out.length).toBe(path.length - 2);
    });

    test('separates mining steps by tool key', () => {
        const path: ActionStep[] = [
            { action: 'mine', what: 'stone', tool: 'wooden_pickaxe', count: 1 },
            { action: 'mine', what: 'stone', tool: 'stone_pickaxe', count: 2 },
            { action: 'mine', what: 'stone', tool: 'wooden_pickaxe', count: 3 }
        ];
        const out = hoistMiningInPath(path);
        const wood = out.find(s => s.action === 'mine' && (s as any).tool === 'wooden_pickaxe');
        const stone = out.find(s => s.action === 'mine' && (s as any).tool === 'stone_pickaxe');
        expect(wood!.count).toBe(4);
        expect(stone!.count).toBe(2);
        expect(out.filter(s => s.action === 'mine').length).toBe(2);
    });

    test('handles targetItem key variant', () => {
        const path: ActionStep[] = [
            { action: 'mine', what: 'oak_log', targetItem: 'oak_log', count: 1 },
            { action: 'mine', what: 'oak_log', targetItem: 'oak_log', count: 2 }
        ];
        const out = hoistMiningInPath(path);
        expect(out.length).toBe(1);
        expect(out[0].what).toBe('oak_log');
        expect((out[0] as any).targetItem).toBe('oak_log');
        expect(out[0].count).toBe(3);
    });

    test('hoistMiningInPaths maps over path arrays', () => {
        const paths: ActionStep[][] = [
            [ { action: 'mine', what: 'iron_ore', count: 1 }, { action: 'mine', what: 'iron_ore', count: 2 } ],
            [ { action: 'mine', what: 'coal_ore', count: 1 } ]
        ];
        const out = hoistMiningInPaths(paths);
        expect(out[0].length).toBe(1);
        expect(out[0][0].count).toBe(3);
        expect(out[1].length).toBe(1);
        expect(out[1][0].what).toBe('coal_ore');
    });
});

