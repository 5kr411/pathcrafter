const plan = require('../../planner');
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

    test('each generator yields at least 10 paths with empty inventory (bounded)', () => {
        const N = 10;
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory });
        const { enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, enumerateActionPathsGenerator } = analyzeRecipes._internals;

        const firstGen = collectFirstN(enumerateActionPathsGenerator(tree, { inventory }), N);
        const firstShortest = collectFirstN(enumerateShortestPathsGenerator(tree, { inventory }), N);
        const firstLowest = collectFirstN(enumerateLowestWeightPathsGenerator(tree, { inventory }), N);

        expect(firstGen.length).toBe(N);
        expect(firstShortest.length).toBe(N);
        expect(firstLowest.length).toBe(N);
    });

    test('top N paths in each generator do not duplicate persistent deps (crafting_table/furnace)', () => {
        const N = 1000;
        const inventory = {};
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory });
        const { enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, enumerateActionPathsGenerator } = analyzeRecipes._internals;

        function produced(step) {
            if (!step) return null;
            if (step.action === 'craft' && step.result && step.result.item) return step.result.item;
            if (step.action === 'smelt' && step.result && step.result.item) return step.result.item;
            if ((step.action === 'mine' || step.action === 'hunt') && (step.targetItem || step.what)) return (step.targetItem || step.what);
            return null;
        }

        function countAcq(path, itemName) {
            let c = 0;
            for (const st of path) if (produced(st) === itemName) c++;
            return c;
        }

        const gens = [
            collectFirstN(enumerateActionPathsGenerator(tree, { inventory }), N),
            collectFirstN(enumerateShortestPathsGenerator(tree, { inventory }), N),
            collectFirstN(enumerateLowestWeightPathsGenerator(tree, { inventory }), N)
        ];

        for (const paths of gens) {
            for (const p of paths) {
                expect(countAcq(p, 'crafting_table')).toBeLessThanOrEqual(1);
                expect(countAcq(p, 'furnace')).toBeLessThanOrEqual(1);
            }
        }
    });
});


