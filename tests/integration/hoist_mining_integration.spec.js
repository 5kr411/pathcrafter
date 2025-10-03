const analyzeRecipes = require('../../recipeAnalyzer');
const { generateTopNAndFilter } = require('../../path_filters');

function firstMineCounts(path) {
    let first = null;
    const mineIndices = [];
    for (let i = 0; i < path.length; i++) {
        const s = path[i];
        if (s && s.action === 'mine') {
            mineIndices.push(i);
            if (first === null) first = { what: s.what, targetItem: s.targetItem, tool: s.tool, count: s.count };
        }
    }
    return { first, mineIndices };
}

describe('integration: mining hoist applied post generation/filtering', () => {
    const { resolveMcData } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('wooden_pickaxe: repeated log mining is hoisted into first occurrence', async () => {
        const inventory = { crafting_table: 1 };
        const perGenerator = 50;
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2,
            blocks: { oak_log: { count: 50, closestDistance: 5, averageDistance: 10 } }, 
            entities: {}
        };
        const paths = await generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true });
        expect(paths.length).toBeGreaterThan(0);
        const p = paths.find(pp => pp.some(s => s.action === 'mine' && typeof (s.targetItem || s.what) === 'string' && ((s.targetItem || s.what).endsWith('_log'))));
        expect(!!p).toBe(true);
        const { first, mineIndices } = firstMineCounts(p);
        expect(mineIndices.length).toBeGreaterThan(0);
        // only one mining step for logs should remain if multiple existed originally
        const logMines = p.filter(s => s.action === 'mine' && typeof (s.targetItem || s.what) === 'string' && ((s.targetItem || s.what).endsWith('_log')));
        expect(logMines.length).toBe(1);
        // sanity: aggregated count >= 2
        expect(logMines[0].count).toBeGreaterThanOrEqual(2);
        // and no earlier same-key mining step exists before the kept one
        const kept = logMines[0];
        const keptIdx = p.indexOf(kept);
        const hasEarlierSameKey = p.slice(0, keptIdx).some(s => s && s.action === 'mine' && s.what === kept.what && (s.targetItem || null) === (kept.targetItem || null) && (s.tool || null) === (kept.tool || null));
        expect(hasEarlierSameKey).toBe(false);
    });

    test('hoisting respects tool differences', async () => {
        const inventory = { crafting_table: 1, oak_planks: 5 };
        const perGenerator = 50;
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2,
            blocks: { 
                oak_log: { count: 50, closestDistance: 5, averageDistance: 10 },
                cobblestone: { count: 100, closestDistance: 3, averageDistance: 8 },
                stone: { count: 100, closestDistance: 3, averageDistance: 8 }
            }, 
            entities: {}
        };
        const paths = await generateTopNAndFilter('1.20.1', 'stone', 3, { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true });
        expect(paths.length).toBeGreaterThan(0);
        const anyWithMultipleMines = paths.find(path => path.filter(s => s.action === 'mine').length >= 1);
        expect(anyWithMultipleMines).toBeTruthy();
        // For safety, ensure no two mines with same key exist
        for (const path of paths.slice(0, 10)) {
            const seen = new Set();
            for (const s of path) {
                if (s.action !== 'mine') continue;
                const key = JSON.stringify({ what: s.what, targetItem: s.targetItem, tool: s.tool });
                expect(seen.has(key)).toBe(false);
                seen.add(key);
            }
        }
    });

});


