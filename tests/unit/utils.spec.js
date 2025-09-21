const analyzeRecipes = require('../../recipeAnalyzer');

describe('unit: helpers', () => {
    const { chooseMinimalToolName, renderName, genericizeItemName, resolveMcData } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('chooseMinimalToolName prefers lower tier', () => {
        expect(chooseMinimalToolName(['iron_pickaxe', 'wooden_pickaxe', 'stone_pickaxe'])).toBe('wooden_pickaxe');
    });

    test('genericizeItemName turns oak_planks -> generic_planks (after context init)', () => {
        // Initialize context so wood species tokens are loaded
        analyzeRecipes(mcData, 'crafting_table', 1, { log: false, inventory: {} });
        expect(genericizeItemName('oak_planks')).toBe('generic_planks');
    });

    test('renderName keeps species when selectedSpecies set', () => {
        expect(renderName('planks', { selectedSpecies: 'cherry' }).startsWith('cherry')).toBe(true);
    });
});

describe('unit: crafting table dependency', () => {
    const { enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = analyzeRecipes._internals;
    const mcData = analyzeRecipes._internals.resolveMcData('1.20.1');

    function usesTable(step) { return step && step.action === 'craft' && step.what === 'table'; }
    function produces(name, step) {
        if (!step) return false;
        if (step.action === 'craft') return step.result && step.result.item === name;
        if (step.action === 'mine' || step.action === 'hunt') return (step.targetItem || step.what) === name;
        if (step.action === 'smelt') return step.result && step.result.item === name;
        return false;
    }
    function hasTableBeforeUse(path) {
        let tables = 0;
        for (const st of path) {
            if (produces('crafting_table', st)) tables += (st.result && st.result.perCraftCount ? st.result.perCraftCount : 1) * (st.count || 1);
            if (usesTable(st)) { if (tables <= 0) return false; }
        }
        return true;
    }

    test('shortest paths never use table before acquiring one (empty inventory)', () => {
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory });
        let checked = 0;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            expect(hasTableBeforeUse(path)).toBe(true);
            if (++checked >= 25) break;
        }
    });

    test('lowest-weight paths never use table before acquiring one (empty inventory)', () => {
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'stone_pickaxe', 1, { log: false, inventory });
        let checked = 0;
        for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
            expect(hasTableBeforeUse(path)).toBe(true);
            if (++checked >= 25) break;
        }
    });
});


