const analyzeRecipes = require('../../recipeAnalyzer');

describe('integration: hunting feathers with no inventory', () => {
    const { resolveMcData, enumerateShortestPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('yields a hunt action for chicken (feather source)', () => {
        const tree = analyzeRecipes(mcData, 'feather', 1, { log: false, inventory: {} });
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory: {} }));
        expect(path).toBeDefined();
        expect(path.some(step => step.action === 'hunt')).toBe(true);
    });
});


