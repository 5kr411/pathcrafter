const analyzeRecipes = require('../../recipeAnalyzer');

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
    const { resolveMcData, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, computePathWeight } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');
    const inventory = { crafting_table: 1, oak_planks: 3 };
    const snapshot = {
        version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2,
        blocks: { oak_log: { count: 50, closestDistance: 5, averageDistance: 10 } }, 
        entities: {}
    };

    test('shortest paths generator maintains length ordering', () => {
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const shortest = Array.from(enumerateShortestPathsGenerator(tree, { inventory })).map(p => ({ s: normalizePath(p), l: p.length }));
        
        // ordering: shortest non-decreasing lengths
        for (let i = 1; i < shortest.length; i++) {
            expect(shortest[i].l).toBeGreaterThanOrEqual(shortest[i - 1].l);
        }
    });

    test('lowest weight generator maintains weight ordering', () => {
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const lowest = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })).map(p => ({ s: normalizePath(p), w: computePathWeight(p) }));
        
        // ordering: lowest non-decreasing weights
        for (let i = 1; i < lowest.length; i++) {
            expect(lowest[i].w).toBeGreaterThanOrEqual(lowest[i - 1].w);
        }
    });

    test('shortest paths includes expected optimal path', () => {
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const shortest = Array.from(enumerateShortestPathsGenerator(tree, { inventory })).map(normalizePath);
        
        const missingKey = 'mine oak_planks 2 | craft inventory 1 2 oak_planks->4 stick | craft table 1 3 oak_planks+2 stick->1 wooden_pickaxe';
        expect(shortest.includes(missingKey)).toBe(true);
    });
});


