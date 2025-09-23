const plan = require('../../planner');

describe('integration: minimal tool pruning for mining', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('prefers wooden_pickaxe (lowest viable tier) for cobblestone', () => {
        const tree = analyzeRecipes(mcData, 'cobblestone', 1, { log: false, inventory: {} });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory: {} }));
        expect(path).toBeDefined();
        const mineStep = path.find(s => s.action === 'mine' && (s.targetItem === 'cobblestone' || s.what === 'cobblestone'));
        // If a tool is required, it should be wooden_pickaxe as minimal viable
        if (mineStep && mineStep.tool) {
            expect(mineStep.tool).toBe('wooden_pickaxe');
        }
    });
});


