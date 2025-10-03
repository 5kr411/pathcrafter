const analyzeRecipes = require('../../recipeAnalyzer');

describe('integration: prevent crafting iron_ingot from nuggets without obtaining them', () => {
    const { resolveMcData, enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');
    
    const snapshot = {
        version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2,
        blocks: { 
            oak_log: { count: 50, closestDistance: 5, averageDistance: 10 },
            iron_ore: { count: 20, closestDistance: 10, averageDistance: 15 },
            cobblestone: { count: 100, closestDistance: 3, averageDistance: 8 }
        }, 
        entities: {}
    };

    test('without nuggets, shortest paths do not include nugget->ingot craft', () => {
        const inventory = { furnace: 1, coal: 1, raw_iron: 1, crafting_table: 1, oak_planks: 5 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Only check first 20 paths - enough to verify behavior
        let checked = 0;
        let hasInvalid = false;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            if (path.some(step => step.action === 'craft' && step.result?.item === 'iron_ingot' && (step.ingredients || []).some(i => i.item === 'iron_nugget'))) {
                hasInvalid = true;
                break;
            }
            if (++checked >= 20) break;
        }
        expect(hasInvalid).toBe(false);
    });

    test('without nuggets, lowest weight paths do not include nugget->ingot craft', () => {
        const inventory = { furnace: 1, coal: 1, raw_iron: 1, crafting_table: 1, oak_planks: 5 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Only check first 20 paths
        let checked = 0;
        let hasInvalid = false;
        for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
            if (path.some(step => step.action === 'craft' && step.result?.item === 'iron_ingot' && (step.ingredients || []).some(i => i.item === 'iron_nugget'))) {
                hasInvalid = true;
                break;
            }
            if (++checked >= 20) break;
        }
        expect(hasInvalid).toBe(false);
    });

    test('with nuggets in inventory, shortest paths include nugget->ingot option', () => {
        const inventory = { iron_nugget: 9, crafting_table: 1 };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory });
        // Only check first 10 paths - should find it quickly
        let checked = 0;
        let hasExpected = false;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            if (path.some(step => step.action === 'craft' && step.result?.item === 'iron_ingot' && (step.ingredients || []).some(i => i.item === 'iron_nugget'))) {
                hasExpected = true;
                break;
            }
            if (++checked >= 10) break;
        }
        expect(hasExpected).toBe(true);
    });
});


