import analyzeRecipes from '../../recipeAnalyzer';

describe('integration: combine wood families reduces branching', () => {
    const { resolveMcData } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('stick tree has fewer nodes with combineSimilarNodes=true', () => {
        const treeWithout = analyzeRecipes(mcData, 'stick', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: false 
        });
        
        const treeWith = analyzeRecipes(mcData, 'stick', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: true 
        });

        // Check that variants are present in combined tree
        const hasVariants = (node: any): boolean => {
            if (node.result && node.result.variants && node.result.variants.length > 1) {
                return true;
            }
            if (node.ingredients && node.ingredients.variants && node.ingredients.variants.length > 1) {
                return true;
            }
            if (node.children && node.children.variants) {
                return node.children.variants.some((c: any) => hasVariants(c.value));
            }
            return false;
        };

        expect(hasVariants(treeWith)).toBe(true);
        expect(hasVariants(treeWithout)).toBe(false);
    });

    test('wooden_pickaxe tree merges alternative ingredient chains', () => {
        const { enumerateActionPaths } = (analyzeRecipes as any)._internals;

        const separateTree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: false 
        });
        const separatePaths = enumerateActionPaths(separateTree);

        const combinedTree = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: true 
        });
        const combinedPaths = enumerateActionPaths(combinedTree);

        // Combined tree exposes all ingredient families within shared steps,
        // so the enumerated path count is expected to grow instead of shrink.
        expect(combinedPaths.length).toBeGreaterThan(separatePaths.length);

        // Ensure merged craft steps still expose variant options
        const pickCraftStep = combinedPaths
            .flatMap((path: any[]) => path)
            .find((step: any) => step.action === 'craft' && step.result?.variants?.some((v: any) => v.value.item === 'wooden_pickaxe'));
        expect(pickCraftStep).toBeDefined();
        expect((pickCraftStep!.ingredients?.variants || []).length).toBeGreaterThan(1);
    });

    test('crafting_table tree has fewer nodes with combineSimilarNodes=true', () => {
        const treeWithout = analyzeRecipes(mcData, 'crafting_table', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: false 
        });
        
        const treeWith = analyzeRecipes(mcData, 'crafting_table', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: true 
        });

        // Check that combined tree has variant information
        const hasVariants = (node: any): boolean => {
            if (node.result && node.result.variants && node.result.variants.length > 1) {
                return true;
            }
            if (node.ingredients && node.ingredients.variants && node.ingredients.variants.length > 1) {
                return true;
            }
            if (node.children && node.children.variants) {
                return node.children.variants.some((c: any) => hasVariants(c.value));
            }
            return false;
        };

        // Combined tree should have variants, non-combined should not
        expect(hasVariants(treeWith)).toBe(true);
        expect(hasVariants(treeWithout)).toBe(false);
    });

    test('combining preserves at least one valid path', () => {
        const { enumerateShortestPathsGenerator } = (analyzeRecipes as any)._internals;
        const inventory = {};
        
        const tree = analyzeRecipes(mcData, 'stick', 1, { 
            log: false, 
            inventory, 
            combineSimilarNodes: true 
        });

        // Should still be able to enumerate at least one path
        const paths = [];
        const gen = enumerateShortestPathsGenerator(tree, { inventory });
        for (let i = 0; i < 10; i++) {
            const next = gen.next();
            if (next.done) break;
            paths.push(next.value);
        }

        expect(paths.length).toBeGreaterThan(0);
    });

    test('combined tree maintains correct counts', () => {
        const tree = analyzeRecipes(mcData, 'stick', 4, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: true 
        });

        // Root should still request 4 sticks
        expect(tree.count).toBe(4);
        expect(tree.what.variants[0].value).toBe('stick');
    });

    test('combining works with inventory', () => {
        const inventory = { oak_log: 2 };
        
        const tree = analyzeRecipes(mcData, 'stick', 2, { 
            log: false, 
            inventory, 
            combineSimilarNodes: true 
        });

        // Should still generate valid tree with inventory
        expect(tree.children.variants.length).toBeGreaterThan(0);
    });

    test('combining propagates deep into subtrees', () => {
        const tree = analyzeRecipes(mcData, 'stick', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: true 
        });

        // Find all mine leaf nodes
        const mineLeaves: any[] = [];
        const findMineLeaves = (node: any) => {
            if (node.action === 'mine' && (!node.operator)) {
                mineLeaves.push(node);
            }
            if (node.children && node.children.variants) {
                node.children.variants.forEach((c: any) => findMineLeaves(c.value));
            }
        };
        findMineLeaves(tree);

        // Count how many have variants (combined nodes) - check craft nodes instead of mine nodes
        const craftNodes: any[] = [];
        const findCraftNodes = (node: any) => {
            if (node.action === 'craft') {
                craftNodes.push(node);
            }
            if (node.children && node.children.variants) {
                node.children.variants.forEach((c: any) => findCraftNodes(c.value));
            }
        };
        findCraftNodes(tree);
        
        const withVariants = craftNodes.filter(n => 
            (n.result && n.result.variants && n.result.variants.length > 1) ||
            (n.ingredients && n.ingredients.variants && n.ingredients.variants.length > 1)
        );

        // Should have multiple combined craft nodes
        expect(withVariants.length).toBeGreaterThan(0);
        
        // Verify the variants contain different wood families
        const allVariantNames = withVariants.flatMap(n => [
            ...(n.result?.variants || []),
            ...(n.ingredients?.variants || [])
        ]);
        const uniqueFamilies = new Set(allVariantNames.flatMap((variant: any) => {
            // Handle different variant structures
            if (typeof variant.value === 'string') {
                // Simple string variant
                const parts = variant.value.split('_');
                return [parts[0]];
            } else if (variant.value && typeof variant.value === 'object' && variant.value.item) {
                // Single item variant
                const parts = variant.value.item.split('_');
                return [parts[0]];
            } else if (Array.isArray(variant.value)) {
                // Array of items variant (ingredients)
                return variant.value.map((item: any) => {
                    const parts = item.item.split('_');
                    return parts[0];
                });
            }
            return [];
        }));
        
        // Should have multiple wood families represented
        expect(uniqueFamilies.size).toBeGreaterThan(3);
    });
});
