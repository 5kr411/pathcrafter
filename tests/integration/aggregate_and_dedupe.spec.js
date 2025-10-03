const analyzeRecipes = require('../../recipeAnalyzer');
const { dedupePaths, generateTopNPathsFromGenerators } = require('../../path_generators/generateTopN');

function countDuplicates(arr) {
    const seen = new Map();
    let dups = 0;
    for (const p of arr) {
        const k = JSON.stringify(p);
        const cur = seen.get(k) || 0;
        if (cur > 0) dups += 1;
        seen.set(k, cur + 1);
    }
    return dups;
}

describe('integration: aggregate top-N and dedupe across generators', () => {
    const { resolveMcData } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('wooden_pickaxe scenario produces duplicates across generators and dedupe removes them', () => {
        const { enumerateActionPathsGenerator, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = analyzeRecipes._internals;
        const inventory = { crafting_table: 1, oak_planks: 3 };
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory });

        const perGenerator = 20;
        function takeN(iter, n) { const out = []; for (const p of iter) { out.push(p); if (out.length >= n) break; } return out; }

        const a = takeN(enumerateActionPathsGenerator(tree, { inventory }), perGenerator);
        const b = takeN(enumerateShortestPathsGenerator(tree, { inventory }), perGenerator);
        const c = takeN(enumerateLowestWeightPathsGenerator(tree, { inventory }), perGenerator);

        const aggregated = a.concat(b).concat(c);
        const beforeDups = countDuplicates(aggregated);
        expect(beforeDups).toBeGreaterThan(0);

        const unique = dedupePaths(aggregated);
        const afterDups = countDuplicates(unique);
        expect(afterDups).toBe(0);
        expect(unique.length).toBeGreaterThan(0);
        expect(unique.length).toBeLessThan(aggregated.length);
    });

    test('aggregated paths are returned sorted by non-decreasing weight', async () => {
        const { computePathWeight } = analyzeRecipes._internals;
        const inventory = { crafting_table: 1, oak_planks: 3 };
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory });
        const perGenerator = 20;
        const combinedSorted = await generateTopNPathsFromGenerators(tree, { inventory }, perGenerator);
        expect(combinedSorted.length).toBeGreaterThan(0);
        for (let i = 1; i < combinedSorted.length; i++) {
            const prev = computePathWeight(combinedSorted[i - 1]);
            const cur = computePathWeight(combinedSorted[i]);
            expect(cur).toBeGreaterThanOrEqual(prev);
        }
    });

});


