const analyzeRecipes = require('../../recipeAnalyzer');
const { collectFirstN } = require('../utils/helpers');

describe('integration: smelting iron_ingot with furnace in inventory', () => {
    const { resolveMcData, enumerateLowestWeightPathsGenerator, enumerateActionPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('tree contains smelt route and some path smelts iron_ingot with coal when furnace present', () => {
        const inventory = { furnace: 1, coal: 1, raw_iron: 1 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory });

        // Ensure the tree includes a smelt node to iron_ingot
        let foundSmeltNode = false;
        (function walk(node) {
            if (!node || foundSmeltNode) return;
            if (node.action === 'smelt' && node.result && node.result.item === 'iron_ingot') { foundSmeltNode = true; return; }
            const kids = node.children || [];
            for (const c of kids) walk(c);
        })(tree);
        expect(foundSmeltNode).toBe(true);

        // Prefer existence via original-order generator to avoid weighting bias
        let found = false;
        for (const path of enumerateActionPathsGenerator(tree, { inventory })) {
            if (path.some(step => step.action === 'smelt' && step.fuel === 'coal' && step.result?.item === 'iron_ingot')) { found = true; break; }
        }
        expect(found).toBe(true);
    });
});


