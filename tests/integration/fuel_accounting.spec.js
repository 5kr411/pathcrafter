const analyzeRecipes = require('../../recipeAnalyzer');

describe('integration: fuel accounting for multiple smelts', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('smelting 9 stone consumes >=2 coal units in a valid path', () => {
        const inventory = { furnace: 1, cobblestone: 9, crafting_table: 1 }; // ensure input exists
        const tree = analyzeRecipes(mcData, 'stone', 9, { log: false, inventory });
        // Use shortest paths generator for speed, just check first few paths
        let foundFuelOk = false;
        let checked = 0;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            const smeltSteps = path.filter(s => s.action === 'smelt' && s.result?.item === 'stone');
            let requiredCoal = 0;
            for (const st of smeltSteps) {
                if (st.fuel === 'coal') {
                    const count = Number(st.count) || 1;
                    const perFuel = 8; // from config
                    requiredCoal += Math.ceil(count / perFuel);
                }
            }
            if (requiredCoal >= 2) { foundFuelOk = true; break; }
            if (++checked >= 20) break; // limit search
        }
        expect(foundFuelOk).toBe(true);
    });
});


