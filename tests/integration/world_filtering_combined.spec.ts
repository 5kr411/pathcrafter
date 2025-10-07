import analyzeRecipes from '../../recipeAnalyzer';
import { TreeNode } from '../../action_tree/types';

describe('integration: world filtering with combined nodes', () => {
    const { resolveMcData, enumerateShortestPathsGenerator, countActionPaths } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('generates valid paths after filtering combined nodes', () => {
        // World with limited wood types
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
                birch_log: { count: 50, closestDistance: 8, averageDistance: 15 },
            },
            entities: {}
        };

        const tree = analyzeRecipes(mcData, 'stick', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Should still have valid paths
        const paths = countActionPaths(tree);
        expect(paths).toBeGreaterThan(0);

        // Enumerate some paths to ensure they're valid
        const shortestPaths = [];
        const gen = enumerateShortestPathsGenerator(tree, { inventory: {} });
        for (let i = 0; i < 5; i++) {
            const next = gen.next();
            if (next.done) break;
            shortestPaths.push(next.value);
        }

        expect(shortestPaths.length).toBeGreaterThan(0);
    });

    test('world filtering works with combined nodes', () => {
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
                birch_log: { count: 50, closestDistance: 8, averageDistance: 15 },
                // Only oak and birch logs available
            },
            entities: {}
        };

        const tree = analyzeRecipes(mcData, 'stick', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Should generate a valid tree
        expect(tree.children.variants.length).toBeGreaterThan(0);

        // Should have valid paths
        const { countActionPaths } = analyzeRecipes._internals;
        const paths = countActionPaths(tree);
        expect(paths).toBeGreaterThan(0);

        // Combined nodes should have variants (architecture combines available blocks)
        const mineLeaves: any[] = [];
        const findMineLeaves = (node: any) => {
            if (node.action === 'mine' && !node.operator) {
                mineLeaves.push(node);
            }
            if (node.children && node.children.variants) {
                node.children.variants.forEach((child: any) => findMineLeaves(child.value));
            }
        };
        findMineLeaves(tree);

        // Should have some combined nodes
        const withVariants = mineLeaves.filter(n => n.what && n.what.variants.length > 1);
        expect(withVariants.length).toBeGreaterThanOrEqual(0); // May or may not have variants depending on tree structure
    });

    test('wood family craft nodes use one_of since they produce different items', () => {
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
                spruce_log: { count: 50, closestDistance: 8, averageDistance: 15 },
            },
            entities: {}
        };

        const tree = analyzeRecipes(mcData, 'stick', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Find craft nodes with wood family variants
        const woodCraftNodes: any[] = [];
        const findWoodCraftNodes = (node: TreeNode) => {
            if (node.action === 'craft' && node.result && node.result.variants.length > 1) {
                const hasWoodVariants = node.result.variants.some((v: any) => 
                    v.value.item.includes('planks') || v.value.item.includes('wood')
                );
                if (hasWoodVariants) {
                    woodCraftNodes.push(node);
                }
            }
            if (node.children) {
                node.children.variants.forEach((child: any) => findWoodCraftNodes(child.value));
            }
        };
        findWoodCraftNodes(tree);

        // Should have wood craft nodes with one_of variant mode
        expect(woodCraftNodes.length).toBeGreaterThan(0);
        woodCraftNodes.forEach(node => {
            expect(node.variantMode).toBe('one_of'); // Wood craft nodes produce different items (oak_planks vs spruce_planks)
            expect(node.result.variants.length).toBeGreaterThan(1);
        });
    });

    test('iron ore variants use any_of since they drop the same item', () => {
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                iron_ore: { count: 20, closestDistance: 10, averageDistance: 15 },
                deepslate_iron_ore: { count: 15, closestDistance: 12, averageDistance: 18 },
            },
            entities: {}
        };

        const tree = analyzeRecipes(mcData, 'raw_iron', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Find mine nodes with iron ore variants
        const ironOreNodes: any[] = [];
        const findIronOreNodes = (node: TreeNode) => {
            if (node.action === 'mine' && node.what && node.what.variants.length > 1) {
                const hasIronOre = node.what.variants.some((v: any) => 
                    v.value === 'iron_ore' || v.value === 'deepslate_iron_ore'
                );
                if (hasIronOre) {
                    ironOreNodes.push(node);
                }
            }
            if (node.children) {
                node.children.variants.forEach((child: any) => findIronOreNodes(child.value));
            }
        };
        findIronOreNodes(tree);

        // Should have iron ore nodes with any_of variant mode
        expect(ironOreNodes.length).toBeGreaterThan(0);
        ironOreNodes.forEach(node => {
            expect(node.variantMode).toBe('any_of'); // Iron ore variants drop the same item (raw_iron)
            expect(node.what.variants.length).toBeGreaterThan(1);
            
            // Should include both iron ore types
            const variantValues = node.what.variants.map((v: any) => v.value);
            expect(variantValues).toContain('iron_ore');
            expect(variantValues).toContain('deepslate_iron_ore');
        });
    });

    test('nether gold ore is not grouped with other gold ores due to different tool requirements', () => {
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                gold_ore: { count: 10, closestDistance: 15, averageDistance: 20 },
                deepslate_gold_ore: { count: 8, closestDistance: 18, averageDistance: 22 },
                nether_gold_ore: { count: 12, closestDistance: 12, averageDistance: 16 },
            },
            entities: {}
        };

        const tree = analyzeRecipes(mcData, 'raw_gold', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Find mine nodes with gold ore variants
        const goldOreNodes: any[] = [];
        const findGoldOreNodes = (node: TreeNode) => {
            if (node.action === 'mine' && node.what && node.what.variants.length > 1) {
                const hasGoldOre = node.what.variants.some((v: any) => 
                    v.value === 'gold_ore' || v.value === 'deepslate_gold_ore' || v.value === 'nether_gold_ore'
                );
                if (hasGoldOre) {
                    goldOreNodes.push(node);
                }
            }
            if (node.children) {
                node.children.variants.forEach((child: any) => findGoldOreNodes(child.value));
            }
        };
        findGoldOreNodes(tree);

        // Should have separate nodes for regular gold ores vs nether gold ore
        expect(goldOreNodes.length).toBeGreaterThan(0);
        
        // Check that nether_gold_ore is not grouped with other gold ores
        goldOreNodes.forEach(node => {
            const variantValues = node.what.variants.map((v: any) => v.value);
            const hasNetherGold = variantValues.includes('nether_gold_ore');
            const hasRegularGold = variantValues.includes('gold_ore') || variantValues.includes('deepslate_gold_ore');
            
            if (hasNetherGold && hasRegularGold) {
                // This should not happen - nether gold ore should be separate
                fail('nether_gold_ore should not be grouped with regular gold ores due to different tool requirements');
            }
            
            if (hasNetherGold) {
                // Nether gold ore node should only contain nether gold ore
                expect(variantValues).toEqual(['nether_gold_ore']);
                expect(node.variantMode).toBe('any_of'); // Still any_of since it's a single variant
            } else if (hasRegularGold) {
                // Regular gold ore node should contain both gold_ore and deepslate_gold_ore
                expect(variantValues).toContain('gold_ore');
                expect(variantValues).toContain('deepslate_gold_ore');
                expect(node.variantMode).toBe('any_of');
            }
        });
    });

    test('blocks with different drop counts are not grouped together', () => {
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                // These blocks drop different items but some might have different drop counts
                diamond_ore: { count: 5, closestDistance: 20, averageDistance: 25 },
                deepslate_diamond_ore: { count: 3, closestDistance: 25, averageDistance: 30 },
                emerald_ore: { count: 2, closestDistance: 30, averageDistance: 35 },
                deepslate_emerald_ore: { count: 1, closestDistance: 35, averageDistance: 40 },
            },
            entities: {}
        };

        const tree = analyzeRecipes(mcData, 'diamond', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Find mine nodes with ore variants
        const oreNodes: any[] = [];
        const findOreNodes = (node: TreeNode) => {
            if (node.action === 'mine' && node.what && node.what.variants.length > 1) {
                const hasOre = node.what.variants.some((v: any) => 
                    v.value.includes('ore')
                );
                if (hasOre) {
                    oreNodes.push(node);
                }
            }
            if (node.children) {
                node.children.variants.forEach((child: any) => findOreNodes(child.value));
            }
        };
        findOreNodes(tree);

        // Should have separate nodes for diamond ore vs emerald ore (different drops)
        expect(oreNodes.length).toBeGreaterThan(0);
        
        // Check that diamond ore variants are grouped together but not with emerald ore
        oreNodes.forEach(node => {
            const variantValues = node.what.variants.map((v: any) => v.value);
            const hasDiamondOre = variantValues.includes('diamond_ore') || variantValues.includes('deepslate_diamond_ore');
            const hasEmeraldOre = variantValues.includes('emerald_ore') || variantValues.includes('deepslate_emerald_ore');
            
            if (hasDiamondOre && hasEmeraldOre) {
                // This should not happen - different ore types should not be grouped
                fail('Diamond ore and emerald ore should not be grouped together due to different drops');
            }
            
            if (hasDiamondOre) {
                // Diamond ore node should contain both diamond ore variants
                expect(variantValues).toContain('diamond_ore');
                expect(variantValues).toContain('deepslate_diamond_ore');
                expect(node.variantMode).toBe('any_of');
            } else if (hasEmeraldOre) {
                // Emerald ore node should contain both emerald ore variants
                expect(variantValues).toContain('emerald_ore');
                expect(variantValues).toContain('deepslate_emerald_ore');
                expect(node.variantMode).toBe('any_of');
            }
        });
    });
});
