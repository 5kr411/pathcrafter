const analyzeRecipes = require('../../recipeAnalyzer');
const { collectFirstN } = require('../utils/helpers');

describe('integration: smelting iron_ingot with furnace in inventory', () => {
    const { resolveMcData, enumerateLowestWeightPathsGenerator, enumerateActionPathsGenerator } = analyzeRecipes._internals;
    const mcData = resolveMcData('1.20.1');

    test('tree contains smelt route and some path smelts iron_ingot with coal when furnace present', () => {
        const inventory = { furnace: 1, coal: 5, raw_iron: 1, crafting_table: 1, oak_planks: 10, stone_pickaxe: 1 };
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1,
            blocks: { oak_log: { count: 10, closestDistance: 5, averageDistance: 10 } },
            entities: {}
        };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });

        // Ensure the tree includes a smelt node to iron_ingot
        let foundSmeltNode = false;
        (function walk(node) {
            if (!node || foundSmeltNode) return;
            if (node.action === 'smelt' && node.result && node.result.item === 'iron_ingot') { foundSmeltNode = true; return; }
            const kids = node.children || [];
            for (const c of kids) walk(c);
        })(tree);
        expect(foundSmeltNode).toBe(true);

        // Use shortest paths generator for speed, just check first 5 paths
        const { enumerateShortestPathsGenerator } = analyzeRecipes._internals;
        let found = false;
        let checked = 0;
        for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
            if (path.some(step => step.action === 'smelt' && step.fuel === 'coal' && step.result?.item === 'iron_ingot')) { found = true; break; }
            if (++checked >= 5) break;
        }
        expect(found).toBe(true);
    });

    test('each generator yields at least 10 paths with starting materials (bounded)', () => {
        const N = 10;
        // Use less inventory to allow more path variations, but include furnace & raw_iron to focus on iron_ingot
        const inventory = { crafting_table: 1, oak_planks: 5, furnace: 1, raw_iron: 1 };
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2,
            blocks: { 
                oak_log: { count: 20, closestDistance: 5, averageDistance: 10 },
                coal_ore: { count: 10, closestDistance: 8, averageDistance: 12 },
                oak_planks: { count: 10, closestDistance: 2, averageDistance: 5 }
            },
            entities: {}
        };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const { enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator, enumerateActionPathsGenerator } = analyzeRecipes._internals;

        const firstGen = collectFirstN(enumerateActionPathsGenerator(tree, { inventory }), N);
        const firstShortest = collectFirstN(enumerateShortestPathsGenerator(tree, { inventory }), N);
        const firstLowest = collectFirstN(enumerateLowestWeightPathsGenerator(tree, { inventory }), N);

        expect(firstGen.length).toBe(N);
        expect(firstShortest.length).toBe(N);
        expect(firstLowest.length).toBe(N);
    });

    test('top N paths in each generator do not duplicate persistent deps (crafting_table/furnace)', () => {
        const N = 20; // Further reduced for speed
        const inventory = { crafting_table: 1, oak_planks: 10, furnace: 1, coal: 5, raw_iron: 1, stone_pickaxe: 1 };
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1,
            blocks: { oak_log: { count: 10, closestDistance: 5, averageDistance: 10 } },
            entities: {}
        };
        const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        const { enumerateShortestPathsGenerator, enumerateLowestWeightPathsGenerator } = analyzeRecipes._internals;

        function produced(step) {
            if (!step) return null;
            if (step.action === 'craft' && step.result && step.result.item) return step.result.item;
            if (step.action === 'smelt' && step.result && step.result.item) return step.result.item;
            if ((step.action === 'mine' || step.action === 'hunt') && (step.targetItem || step.what)) return (step.targetItem || step.what);
            return null;
        }

        function countAcq(path, itemName) {
            let c = 0;
            for (const st of path) if (produced(st) === itemName) c++;
            return c;
        }

        const gens = [
            collectFirstN(enumerateShortestPathsGenerator(tree, { inventory }), N),
            collectFirstN(enumerateLowestWeightPathsGenerator(tree, { inventory }), N)
        ];

        for (const paths of gens) {
            for (const p of paths) {
                expect(countAcq(p, 'crafting_table')).toBeLessThanOrEqual(1);
                expect(countAcq(p, 'furnace')).toBeLessThanOrEqual(1);
            }
        }
    });
});


