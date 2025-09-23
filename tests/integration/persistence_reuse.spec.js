const plan = require('../../planner');

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

    test('tool requirement not duplicated along the path (cobblestone scenario)', () => {
        // Use cobblestone which requires wooden_pickaxe, ensuring only one craft appears
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'cobblestone', 2, { log: false, inventory });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory }));
        expect(path).toBeDefined();
        const woodenPickCrafts = path.filter(step => step.action === 'craft' && step.result?.item === 'wooden_pickaxe').length;
        expect(woodenPickCrafts <= 1).toBe(true);
    });
});


