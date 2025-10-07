import analyzeRecipes from '../../recipeAnalyzer';
import { ActionStep } from '../../action_tree/types';

function normalizePath(path: ActionStep[]): string {
    return path.map(s => {
        if (s.action === 'craft') {
            const ings = (s.ingredients?.variants[0].value || []).map((i: any) => `${i.perCraftCount} ${i.item}`).join('+');
            const res = s.result ? `${s.result.variants[0].value.perCraftCount} ${s.result.variants[0].value.item}` : '?';
            return `craft ${s.what.variants[0].value} ${s.count} ${ings}->${res}`;
        }
        if (s.action === 'smelt') return `smelt ${s.count} ${(s.input && s.input.variants[0].value.item)}->${(s.result && s.result.variants[0].value.item)}`;
        if (s.action === 'mine') return `mine ${((s as any).targetItem?.variants[0].value || s.what.variants[0].value)} ${s.count}`;
        if (s.action === 'hunt') return `hunt ${((s as any).targetItem?.variants[0].value || s.what.variants[0].value)} ${s.count}`;
        return `${s.action} ${s.what.variants[0].value} ${s.count}`;
    }).join(' | ');
}

describe.skip('integration: wooden_pickaxe with inventory', () => {
    const { resolveMcData, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, computePathWeight } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');
    const inventory = { crafting_table: 1, oak_planks: 3 };
    const snapshot = {
        version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2, radius: 32, yMin: 0, yMax: 255,
        blocks: { oak_log: { count: 50, closestDistance: 5, averageDistance: 10 } }, 
        entities: {}
    };

    test('shortest paths generator maintains length ordering', () => {
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const shortest = (Array.from(enumerateShortestPathsGenerator(tree, { inventory })) as ActionStep[][]).map((p: ActionStep[]) => ({ s: normalizePath(p), l: p.length }));
        
        // ordering: shortest non-decreasing lengths
        for (let i = 1; i < shortest.length; i++) {
            expect(shortest[i].l).toBeGreaterThanOrEqual(shortest[i - 1].l);
        }
    });

    test('lowest weight generator maintains weight ordering', () => {
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const lowest = (Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory })) as ActionStep[][]).map((p: ActionStep[]) => ({ s: normalizePath(p), w: computePathWeight(p) }));
        
        // ordering: lowest non-decreasing weights
        for (let i = 1; i < lowest.length; i++) {
            expect(lowest[i].w).toBeGreaterThanOrEqual(lowest[i - 1].w);
        }
    });

    test('shortest paths includes expected optimal path', () => {
        const tree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const shortest = (Array.from(enumerateShortestPathsGenerator(tree, { inventory })) as ActionStep[][]).map(normalizePath);
        
        const missingKey = 'mine oak_planks 2 | craft inventory 1 2 oak_planks->4 stick | craft table 1 3 oak_planks+2 stick->1 wooden_pickaxe';
        expect(shortest.includes(missingKey)).toBe(true);
    });
});

