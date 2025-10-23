import { ActionStep } from '../../action_tree/types';
import plan from '../../planner';

describe('integration: prefer existing higher-tier tool for mining', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = (plan as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('with stone_pickaxe in inventory, do not craft wooden_pickaxe for cobblestone', () => {
        const inventory = new Map([['stone_pickaxe', 1]]);
        const tree = plan(mcData, 'cobblestone', 1, { log: false, inventory });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory })) as ActionStep[][];
        expect(path).toBeDefined();
        // Ensure we use stone_pickaxe for mining if a tool is required
        const mineStep = path.find((s: any) => s.action === 'mine' && (s.targetItem === 'cobblestone' || s.what === 'cobblestone'));
        if (mineStep && (mineStep as any).tool) {
            expect((mineStep as any).tool === 'stone_pickaxe' || (mineStep as any).tool === 'any').toBe(true);
        }
        // Ensure no wooden_pickaxe is crafted along the way
        const woodenPickCrafts = path.filter((s: any) => s.action === 'craft' && s.result?.item === 'wooden_pickaxe');
        expect(woodenPickCrafts.length).toBe(0);
    });
});

