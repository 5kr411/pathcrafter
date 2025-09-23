const plan = require('../../planner');

describe('integration: prefer existing higher-tier tool for mining', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = plan._internals;
    const mcData = resolveMcData('1.20.1');

    test('with stone_pickaxe in inventory, do not craft wooden_pickaxe for cobblestone', () => {
        const inventory = { stone_pickaxe: 1 };
        const tree = plan(mcData, 'cobblestone', 1, { log: false, inventory });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory }));
        expect(path).toBeDefined();
        // Ensure we use stone_pickaxe for mining if a tool is required
        const mineStep = path.find(s => s.action === 'mine' && (s.targetItem === 'cobblestone' || s.what === 'cobblestone'));
        if (mineStep && mineStep.tool) {
            expect(mineStep.tool === 'stone_pickaxe' || mineStep.tool === 'any').toBe(true);
        }
        // Ensure no wooden_pickaxe is crafted along the way
        const woodenPickCrafts = path.filter(s => s.action === 'craft' && s.result?.item === 'wooden_pickaxe');
        expect(woodenPickCrafts.length).toBe(0);
    });
});


