import { plan } from '../../planner';
import { TreeNode, MineLeafNode } from '../../action_tree/types';

describe('unit: world filtering with combined nodes', () => {
    const mcData = (plan as any)._internals.resolveMcData('1.20.1');

    test('filters mine leaf variants based on world availability', () => {
        // World snapshot with only oak and birch logs available
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                oak_log: { count: 50, closestDistance: 5, averageDistance: 10 },
                birch_log: { count: 30, closestDistance: 8, averageDistance: 15 },
                // spruce, jungle, etc. not present
            },
            entities: {}
        };

        const tree = plan(mcData, 'stick', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Find mine leaf nodes
        const mineLeaves: MineLeafNode[] = [];
        const findMineLeaves = (node: TreeNode) => {
            if (node.action === 'mine' && (!('operator' in node) || !node.operator)) {
                mineLeaves.push(node as MineLeafNode);
            }
            if (node.children) {
                node.children.variants.forEach((child: any) => findMineLeaves(child.value));
            }
        };
        findMineLeaves(tree);

        // Find leaves with variants
        const withVariants = mineLeaves.filter(n => n.what && n.what.variants.length > 1);

        if (withVariants.length > 0) {
            // Check that only oak and birch logs are in variants (not spruce, jungle, etc.)
            withVariants.forEach(leaf => {
                if (leaf.what!.variants.some((w: any) => w.value.includes('log'))) {
                    const hasOak = leaf.what!.variants.some((w: any) => w.value.includes('oak_log'));
                    const hasBirch = leaf.what!.variants.some((w: any) => w.value.includes('birch_log'));
                    const hasSpruce = leaf.what!.variants.some((w: any) => w.value.includes('spruce_log'));

                    // Should have oak and/or birch
                    expect(hasOak || hasBirch).toBe(true);

                    // Should NOT have spruce (not in world)
                    expect(hasSpruce).toBe(false);
                }
            });
        }
    });

    test('removes nodes when no variants are available in world', () => {
        // World snapshot with NO logs at all
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                stone: { count: 1000, closestDistance: 1, averageDistance: 5 },
                // No logs available
            },
            entities: {}
        };

        const tree = plan(mcData, 'oak_planks', 4, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Count paths - should be very few since no logs are available
        const { countActionPaths } = (plan as any)._internals;
        const paths = countActionPaths(tree);

        // Should have very few or no paths for crafting from logs
        // (might still have a path for mining planks directly if available)
        expect(paths).toBeLessThan(10);
    });

    test('keeps all variants when world has all types', () => {
        // World snapshot with all wood types
        const worldSnapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            chunkRadius: 2,
            radius: 32,
            yMin: 0,
            yMax: 255,
            blocks: {
                oak_log: { count: 50, closestDistance: 5, averageDistance: 10 },
                spruce_log: { count: 40, closestDistance: 6, averageDistance: 12 },
                birch_log: { count: 30, closestDistance: 8, averageDistance: 15 },
                jungle_log: { count: 25, closestDistance: 10, averageDistance: 18 },
                acacia_log: { count: 20, closestDistance: 12, averageDistance: 20 },
                dark_oak_log: { count: 15, closestDistance: 15, averageDistance: 25 },
            },
            entities: {}
        };

        const tree = plan(mcData, 'stick', 1, {
            log: false,
            inventory: {},
            combineSimilarNodes: true,
            pruneWithWorld: true,
            worldSnapshot
        });

        // Find mine leaf nodes with variants
        const mineLeaves: MineLeafNode[] = [];
        const findMineLeaves = (node: TreeNode) => {
            if (node.action === 'mine' && (!('operator' in node) || !node.operator)) {
                mineLeaves.push(node as MineLeafNode);
            }
            if (node.children) {
                node.children.variants.forEach((child: any) => findMineLeaves(child.value));
            }
        };
        findMineLeaves(tree);

        const withVariants = mineLeaves.filter(n => n.what && n.what.variants.length > 1);

        if (withVariants.length > 0) {
            // Should have multiple wood types since they're all available
            withVariants.forEach(leaf => {
                if (leaf.what!.variants.some((w: any) => w.value.includes('log'))) {
                    // Should have at least 4 different log types
                    expect(leaf.what!.variants.length).toBeGreaterThanOrEqual(4);
                }
            });
        }
    });
});
