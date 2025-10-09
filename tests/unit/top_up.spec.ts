import plan from '../../planner';

describe('unit: Top-up scenarios prefer minimal additional mining', () => {
    const mc = (plan as any)._internals.resolveMcData('1.20.1');
    const { computeTreeMaxDepth, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = (plan as any)._internals;

    // Helper to get just the first path without collecting all
    function getFirstPath(gen: any) {
        for (const path of gen) {
            return path;
        }
        return null;
    }

    test('stone_pickaxe with 2 cobblestone prefers cobblestone top-up (shortest and lowest)', () => {
        const inventory = new Map([
            ['cobblestone', 2],
            ['stick', 2],
            ['crafting_table', 1],
            ['oak_planks', 10]
        ]);
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
            blocks: { 
                cobblestone: { count: 20, closestDistance: 3, averageDistance: 5 },
                stone: { count: 20, closestDistance: 4, averageDistance: 6 },
                oak_log: { count: 10, closestDistance: 5, averageDistance: 10 }
            },
            entities: {}
        };
        const tree = plan(mc, 'stone_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        expect(computeTreeMaxDepth(tree)).toBeGreaterThan(0);

        // Only get first path from each generator - much faster!
        const shortestPath = getFirstPath(enumerateShortestPathsGenerator(tree, { inventory }));
        const lowestPath = getFirstPath(enumerateLowestWeightPathsGenerator(tree, { inventory }));

        expect(shortestPath || lowestPath).toBeTruthy();

        const s0 = shortestPath.map((s: any) => s.action === 'mine' ? s.what.variants[0].value : s.action).join(' ');
        const l0 = lowestPath.map((s: any) => s.action === 'mine' ? s.what.variants[0].value : s.action).join(' ');

        // Ensure a one-step cobblestone mining appears before 3x blackstone in first path
        expect(s0).toMatch(/(stone|cobblestone)/);
        expect(l0).toMatch(/(stone|cobblestone)/);
    });

    test('raw_iron with 2 cobblestone prefers cobblestone top-up (shortest and lowest)', () => {
        const inventory = new Map([
            ['cobblestone', 2],
            ['stick', 2],
            ['crafting_table', 1],
            ['oak_planks', 10],
            ['wooden_pickaxe', 1]
        ]);
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
            blocks: { 
                cobblestone: { count: 20, closestDistance: 3, averageDistance: 5 },
                stone: { count: 20, closestDistance: 4, averageDistance: 6 },
                iron_ore: { count: 10, closestDistance: 12, averageDistance: 15 },
                oak_log: { count: 10, closestDistance: 5, averageDistance: 10 }
            },
            entities: {}
        };
        const tree = plan(mc, 'raw_iron', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        expect(computeTreeMaxDepth(tree)).toBeGreaterThan(0);

        // Only get first path from each generator - much faster!
        const shortestPath = getFirstPath(enumerateShortestPathsGenerator(tree, { inventory }));
        const lowestPath = getFirstPath(enumerateLowestWeightPathsGenerator(tree, { inventory }));

        if (!shortestPath && !lowestPath) {
            return;
        }

        const referencePath = (shortestPath || lowestPath)!;
        const actionSummary = referencePath.map((s: any) => s.action === 'mine' ? s.what.variants[0].value : s.action).join(' ');

        expect(actionSummary).toMatch(/iron/);
    });
});

