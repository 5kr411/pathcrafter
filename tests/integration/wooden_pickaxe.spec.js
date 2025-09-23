const plan = require('../../planner');

function normalizePath(path) {
    return path.map(s => {
        if (s.action === 'craft') {
            const ings = (s.ingredients || []).map(i => `${i.perCraftCount} ${i.item}`).join('+');
            const res = s.result ? `${s.result.perCraftCount} ${s.result.item}` : '?';
            return `craft ${s.what} ${s.count} ${ings}->${res}`;
        }
        if (s.action === 'smelt') return `smelt ${s.count} ${(s.input && s.input.item)}->${(s.result && s.result.item)}`;
        if (s.action === 'mine') return `mine ${(s.targetItem || s.what)} ${s.count}`;
        if (s.action === 'hunt') return `hunt ${(s.targetItem || s.what)} ${s.count}`;
        return `${s.action} ${s.what} ${s.count}`;
    }).join(' | ');
}

describe('integration: wooden_pickaxe with inventory', () => {
    const { resolveMcData, enumerateActionPathsGenerator, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, computePathWeight } = plan._internals;
    const mcData = resolveMcData('1.20.1');
    const inventory = { crafting_table: 1, oak_planks: 3 };

    test('all enumerators return identical path sets; ordering invariants hold', () => {
        const tree = plan(mcData, 'wooden_pickaxe', 1, { log: false, inventory });

        const gen = Array.from(enumerateActionPathsGenerator(tree, { inventory })).map(normalizePath);
        const shortest = Array.from(enumerateShortestPathsGenerator(tree, { inventory })).map(p => ({ s: normalizePath(p), l: p.length }));
        const lowest = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })).map(p => ({ s: normalizePath(p), w: computePathWeight(p) }));

        const setGen = new Set(gen);
        const setShortest = new Set(shortest.map(x => x.s));
        const setLowest = new Set(lowest.map(x => x.s));

        expect(setShortest.size).toBe(setGen.size);
        expect(setLowest.size).toBe(setGen.size);

        // ordering: shortest non-decreasing lengths
        for (let i = 1; i < shortest.length; i++) {
            expect(shortest[i].l).toBeGreaterThanOrEqual(shortest[i - 1].l);
        }
        // ordering: lowest non-decreasing weights
        for (let i = 1; i < lowest.length; i++) {
            expect(lowest[i].w).toBeGreaterThanOrEqual(lowest[i - 1].w);
        }

        // specific path previously missing should be present
        const missingKey = 'mine oak_planks 2 | craft inventory 1 2 oak_planks->4 stick | craft table 1 3 oak_planks+2 stick->1 wooden_pickaxe';
        expect(setGen.has(missingKey)).toBe(true);
        expect(setShortest.has(missingKey)).toBe(true);
        expect(setLowest.has(missingKey)).toBe(true);
    });
});


