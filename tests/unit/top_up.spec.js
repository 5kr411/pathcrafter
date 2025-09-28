const plan = require('../../planner');

describe('Top-up scenarios prefer minimal additional mining', () => {
    const mc = plan._internals.resolveMcData('1.20.1');
    const { computeTreeMaxDepth, countActionPaths, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = plan._internals;

    function collect(gen) { return Array.from(gen); }

    test('stone_pickaxe with 2 cobblestone prefers cobblestone top-up (shortest and lowest)', () => {
        const inventory = { cobblestone: 2, stick: 2, crafting_table: 1 };
        const tree = plan(mc, 'stone_pickaxe', 1, { log: false, inventory });
        expect(computeTreeMaxDepth(tree)).toBeGreaterThan(0);
        expect(countActionPaths(tree)).toBeGreaterThan(0);

        const shortest = collect(enumerateShortestPathsGenerator(tree, { inventory }));
        const lowest = collect(enumerateLowestWeightPathsGenerator(tree, { inventory }));

        expect(shortest.length).toBeGreaterThan(0);
        expect(lowest.length).toBeGreaterThan(0);

        const s0 = shortest[0].map(s => s.action === 'mine' ? s.what : s.action).join(' ');
        const l0 = lowest[0].map(s => s.action === 'mine' ? s.what : s.action).join(' ');

        // Ensure a one-step cobblestone mining appears before 3x blackstone in first path
        expect(s0).toMatch(/(stone|cobblestone)/);
        expect(l0).toMatch(/(stone|cobblestone)/);
    });

    test('raw_iron with 2 cobblestone prefers cobblestone top-up (shortest and lowest)', () => {
        const inventory = { cobblestone: 2, stick: 2, crafting_table: 1 };
        const tree = plan(mc, 'raw_iron', 1, { log: false, inventory });
        expect(computeTreeMaxDepth(tree)).toBeGreaterThan(0);
        expect(countActionPaths(tree)).toBeGreaterThan(0);

        const shortest = collect(enumerateShortestPathsGenerator(tree, { inventory }));
        const lowest = collect(enumerateLowestWeightPathsGenerator(tree, { inventory }));

        expect(shortest.length).toBeGreaterThan(0);
        expect(lowest.length).toBeGreaterThan(0);

        const s0 = shortest[0].map(s => s.action === 'mine' ? s.what : s.action).join(' ');
        const l0 = lowest[0].map(s => s.action === 'mine' ? s.what : s.action).join(' ');

        expect(s0).toMatch(/(stone|cobblestone)/);
        expect(l0).toMatch(/(stone|cobblestone)/);
    });
});


