const analyzeRecipes = require('../../recipeAnalyzer');

describe('integration: persistence reuse of crafting_table and tools', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('does not re-acquire crafting_table when already in inventory', () => {
        const inventory = { crafting_table: 1 };
        const tree = analyzeRecipes(mcData, 'stick', 4, { log: false, inventory });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory }));
        expect(path).toBeDefined();
        const reAcquireTable = path.filter(step => step.action === 'craft' && step.result?.item === 'crafting_table').length;
        expect(reAcquireTable).toBe(0);
    });

    test('tool requirement not duplicated along the path', () => {
        // Choose a block requiring stone_pickaxe; ensure tool acquired once
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'iron_block', 1, { log: false, inventory });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory }));
        expect(path).toBeDefined();
        const stonePickCrafts = path.filter(step => step.action === 'craft' && step.result?.item === 'stone_pickaxe').length;
        expect(stonePickCrafts <= 1).toBe(true);
    });
});


