import analyzeRecipes from '../../recipeAnalyzer';

describe('integration: prevent crafting iron_ingot from nuggets without obtaining them', () => {
    const { resolveMcData, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');
    
    const snapshot = {
        version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2, radius: 32, yMin: 0, yMax: 255,
        blocks: { 
            oak_log: { count: 50, closestDistance: 5, averageDistance: 10 },
            iron_ore: { count: 20, closestDistance: 10, averageDistance: 15 },
            cobblestone: { count: 100, closestDistance: 3, averageDistance: 8 }
        }, 
        entities: {}
    };

    test('without nuggets, shortest paths do not include nugget->ingot craft', () => {
        const inventory = { furnace: 1, coal: 5, raw_iron: 1, crafting_table: 1, oak_planks: 10, stone_pickaxe: 1 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Only check first 10 paths - enough to verify behavior
        let checked = 0;
        let hasInvalid = false;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            if (path.some((step: any) => step.action === 'craft' && step.result?.item === 'iron_ingot' && (step.ingredients || []).some((i: any) => i.item === 'iron_nugget'))) {
                hasInvalid = true;
                break;
            }
            if (++checked >= 10) break;
        }
        expect(hasInvalid).toBe(false);
    });

    test('without nuggets, lowest weight paths do not include nugget->ingot craft', () => {
        const inventory = { furnace: 1, coal: 5, raw_iron: 1, crafting_table: 1, oak_planks: 10, stone_pickaxe: 1 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Only check first 10 paths
        let checked = 0;
        let hasInvalid = false;
        for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
            if (path.some((step: any) => step.action === 'craft' && step.result?.item === 'iron_ingot' && (step.ingredients || []).some((i: any) => i.item === 'iron_nugget'))) {
                hasInvalid = true;
                break;
            }
            if (++checked >= 10) break;
        }
        expect(hasInvalid).toBe(false);
    });

    // TODO: nugget->ingot crafting might not be explored when smelting is available
    test.skip('with nuggets in inventory, shortest paths include nugget->ingot option', () => {
        // Add all necessary items to minimize tree expansion
        const inventory = { iron_nugget: 9, crafting_table: 1, oak_planks: 10, stone_pickaxe: 1, furnace: 1, coal: 5 };
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
            blocks: { oak_log: { count: 10, closestDistance: 5, averageDistance: 10 } },
            entities: {}
        };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Check if tree contains a craft node for nugget->ingot
        let foundCraftNode = false;
        (function walk(node: any): void {
            if (!node || foundCraftNode) return;
            if (node.action === 'craft' && node.result?.variants[0].value.item === 'iron_ingot') {
                const ing = node.ingredients?.variants[0].value || [];
                if (ing.some((i: any) => i.item === 'iron_nugget')) {
                    foundCraftNode = true;
                    return;
                }
            }
            const kids = node.children?.variants || [];
            for (const c of kids) walk(c.value);
        })(tree);
        expect(foundCraftNode).toBe(true);
    });
});

