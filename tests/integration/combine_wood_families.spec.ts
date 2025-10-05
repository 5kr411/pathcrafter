import analyzeRecipes from '../../recipeAnalyzer';
import { TreeNode } from '../../action_tree/types';

describe('integration: combine wood families reduces branching', () => {
    const { resolveMcData, countActionPaths } = (analyzeRecipes as any)._internals;
    const mcData = resolveMcData('1.20.1');

    function countNodes(tree: TreeNode): number {
        if (!tree) return 0;
        let count = 1;
        if (tree.children) {
            for (const child of tree.children) {
                count += countNodes(child);
            }
        }
        return count;
    }

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

        const nodesWithout = countNodes(treeWithout);
        const nodesWith = countNodes(treeWith);

        // Combined tree should have significantly fewer nodes
        expect(nodesWith).toBeLessThan(nodesWithout);
        
        // Should reduce by at least 30% for stick (lots of wood families)
        const reduction = (nodesWithout - nodesWith) / nodesWithout;
        expect(reduction).toBeGreaterThan(0.3);
    });

    test('wooden_pickaxe tree has fewer paths with combineSimilarNodes=true', () => {
        const treeWithout = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: false 
        });
        
        const treeWith = analyzeRecipes(mcData, 'wooden_pickaxe', 1, { 
            log: false, 
            inventory: {}, 
            combineSimilarNodes: true 
        });

        const pathsWithout = countActionPaths(treeWithout);
        const pathsWith = countActionPaths(treeWith);

        // Combined tree should have many fewer paths
        expect(pathsWith).toBeLessThan(pathsWithout);
        
        // The reduction should be dramatic (wood families create explosion)
        expect(pathsWithout).toBeGreaterThan(pathsWith * 2);
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

        const nodesWithout = countNodes(treeWithout);
        const nodesWith = countNodes(treeWith);

        // Combined tree should have fewer nodes
        expect(nodesWith).toBeLessThan(nodesWithout);
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
        expect(tree.what).toBe('stick');
    });

    test('combining works with inventory', () => {
        const inventory = { oak_log: 2 };
        
        const tree = analyzeRecipes(mcData, 'stick', 2, { 
            log: false, 
            inventory, 
            combineSimilarNodes: true 
        });

        // Should still generate valid tree with inventory
        expect(tree.children.length).toBeGreaterThan(0);
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
            if (node.children) {
                node.children.forEach(findMineLeaves);
            }
        };
        findMineLeaves(tree);

        // Count how many have variants (combined nodes)
        const withVariants = mineLeaves.filter(n => n.whatVariants && n.whatVariants.length > 1);

        // Should have multiple combined mine leaf nodes
        expect(withVariants.length).toBeGreaterThan(0);
        
        // Verify the variants contain different wood families
        const allVariantNames = withVariants.flatMap(n => n.whatVariants || []);
        const uniqueFamilies = new Set(allVariantNames.map((name: string) => {
            // Extract family prefix (oak, spruce, birch, etc.)
            const parts = name.split('_');
            return parts[0];
        }));
        
        // Should have multiple wood families represented
        expect(uniqueFamilies.size).toBeGreaterThan(3);
    });
});
