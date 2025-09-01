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


