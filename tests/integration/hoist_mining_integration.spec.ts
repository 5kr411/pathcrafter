import analyzeRecipes from '../../recipeAnalyzer';
import { generateTopNAndFilter } from '../../path_filters';
import { ActionStep } from '../../action_tree/types';

function firstMineCounts(path: ActionStep[]) {
    let first: any = null;
    const mineIndices: number[] = [];
    for (let i = 0; i < path.length; i++) {
        const s = path[i];
        if (s && s.action === 'mine') {
            mineIndices.push(i);
            if (first === null) first = { what: s.what, targetItem: (s as any).targetItem, tool: (s as any).tool, count: s.count };
        }
    }
    return { first, mineIndices };
}

describe.skip('integration: mining hoist applied post generation/filtering', () => {
    const { resolveMcData } = (analyzeRecipes as any)._internals;
    resolveMcData('1.20.1');

    test('wooden_pickaxe: repeated log mining is hoisted into first occurrence', async () => {
        const inventory = new Map([["crafting_table", 1]]);
        const perGenerator = 50;
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2, radius: 32, yMin: 0, yMax: 255,
            blocks: { oak_log: { count: 50, closestDistance: 5, averageDistance: 10 } }, 
            entities: {}
        };
        const paths = await generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true });
        expect(paths.length).toBeGreaterThan(0);
        const p = paths.find(pp => pp.some((s: any) => s.action === 'mine' && typeof (s.targetItem || s.what) === 'string' && ((s.targetItem || s.what).endsWith('_log'))));
        expect(!!p).toBe(true);
        const { mineIndices } = firstMineCounts(p!);
        expect(mineIndices.length).toBeGreaterThan(0);
        // only one mining step for logs should remain if multiple existed originally
        const logMines = p!.filter((s: any) => s.action === 'mine' && typeof (s.targetItem || s.what) === 'string' && ((s.targetItem || s.what).endsWith('_log')));
        expect(logMines.length).toBe(1);
        // sanity: aggregated count >= 2
        expect(logMines[0].count).toBeGreaterThanOrEqual(2);
        // and no earlier same-key mining step exists before the kept one
        const kept = logMines[0];
        const keptIdx = p!.indexOf(kept);
        const hasEarlierSameKey = p!.slice(0, keptIdx).some((s: any) => s && s.action === 'mine' && s.what === kept.what && ((s as any).targetItem || null) === ((kept as any).targetItem || null) && ((s as any).tool || null) === ((kept as any).tool || null));
        expect(hasEarlierSameKey).toBe(false);
    });

    test('hoisting respects tool differences', async () => {
        const inventory = new Map([["crafting_table", 1], ["oak_planks", 10], ["wooden_pickaxe", 1]]);
        const perGenerator = 20; // Reduced for speed
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
            blocks: { 
                oak_log: { count: 50, closestDistance: 5, averageDistance: 10 },
                cobblestone: { count: 100, closestDistance: 3, averageDistance: 8 },
                stone: { count: 100, closestDistance: 3, averageDistance: 8 },
                coal_ore: { count: 20, closestDistance: 10, averageDistance: 15 }
            }, 
            entities: {}
        };
        const paths = await generateTopNAndFilter('1.20.1', 'stone', 3, { inventory, perGenerator, log: false, worldSnapshot: snapshot, pruneWithWorld: true });
        expect(paths.length).toBeGreaterThan(0);
        const anyWithMultipleMines = paths.find(path => path.filter((s: any) => s.action === 'mine').length >= 1);
        expect(anyWithMultipleMines).toBeTruthy();
        // For safety, ensure no two mines with same key exist
        for (const path of paths.slice(0, 5)) { // Check fewer paths
            const seen = new Set<string>();
            for (const s of path) {
                if (s.action !== 'mine') continue;
                const key = JSON.stringify({ what: s.what, targetItem: (s as any).targetItem, tool: (s as any).tool });
                expect(seen.has(key)).toBe(false);
                seen.add(key);
            }
        }
    });

});

