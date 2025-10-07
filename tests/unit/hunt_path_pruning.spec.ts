import plan, { _internals } from '../../planner';
import { enumerateActionPaths } from '../../action_tree/enumerate';

describe.skip('unit: hunt path pruning with world snapshot', () => {
    const mcData = _internals.resolveMcData('1.20.1');

    test('bamboo: hunt path pruned when no pandas in snapshot', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {
                bamboo: { count: 50, closestDistance: 5, averageDistance: 10 }
            },
            entities: {} // No pandas
        };

        const tree = plan(mcData, 'bamboo', 10, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        // Should have mine group but not hunt group
        expect(tree.children).toBeDefined();
        expect(tree.children!.variants.length).toBeGreaterThan(0);
        
        const hasHuntChild = tree.children!.variants.some((child: any) => child.value.action === 'hunt');
        const hasMineChild = tree.children!.variants.some((child: any) => child.value.action === 'mine');
        
        expect(hasHuntChild).toBe(false); // No hunt path when no pandas
        expect(hasMineChild).toBe(true);  // Mine path should exist
    });

    test('bamboo: hunt path included when pandas present in snapshot', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {
                bamboo: { count: 50, closestDistance: 5, averageDistance: 10 }
            },
            entities: {
                panda: { count: 10, closestDistance: 8, averageDistance: 15 }
            }
        };

        const tree = plan(mcData, 'bamboo', 10, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        expect(tree.children).toBeDefined();
        expect(tree.children!.variants.length).toBeGreaterThan(0);
        
        const hasHuntChild = tree.children!.variants.some((child: any) => child.value.action === 'hunt');
        const hasMineChild = tree.children!.variants.some((child: any) => child.value.action === 'mine');
        
        expect(hasHuntChild).toBe(true);  // Hunt path when pandas present
        expect(hasMineChild).toBe(true);  // Mine path also exists
    });

    test('bamboo: only hunt path when pandas present but no bamboo blocks', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {}, // No bamboo blocks
            entities: {
                panda: { count: 10, closestDistance: 8, averageDistance: 15 }
            }
        };

        const tree = plan(mcData, 'bamboo', 10, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        expect(tree.children).toBeDefined();
        expect(tree.children!.variants.length).toBeGreaterThan(0);
        
        const hasHuntChild = tree.children!.variants.some((child: any) => child.value.action === 'hunt');
        const hasMineChild = tree.children!.variants.some((child: any) => child.value.action === 'mine');
        
        expect(hasHuntChild).toBe(true);   // Hunt path when pandas present
        expect(hasMineChild).toBe(false);  // No mine path when no blocks
    });

    test('bamboo: no paths when neither pandas nor blocks present', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {}, // No bamboo blocks
            entities: {} // No pandas
        };

        const tree = plan(mcData, 'bamboo', 10, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        // Tree should have no valid children
        expect(tree.children).toBeDefined();
        expect(tree.children!.variants.length).toBe(0);
    });

    test('string: hunt path pruned when no spiders in snapshot', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {
                cobweb: { count: 5, closestDistance: 10, averageDistance: 15 }
            },
            entities: {} // No spiders
        };

        const tree = plan(mcData, 'string', 5, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        expect(tree.children).toBeDefined();
        
        // Check that hunt group is not present or has no children
        const huntChild = tree.children!.variants.find((child: any) => child.value.action === 'hunt');
        if (huntChild) {
            // If hunt group exists, it should have no children (filtered)
            expect((huntChild.value as any).children.variants.length).toBe(0);
        }
        
        // Mine path should exist for cobweb
        const hasMineChild = tree.children!.variants.some((child: any) => child.value.action === 'mine');
        expect(hasMineChild).toBe(true);
    });

    test('rotten_flesh: only hunt path (no mining alternative)', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {},
            entities: {
                zombie: { count: 20, closestDistance: 5, averageDistance: 12 }
            }
        };

        const tree = plan(mcData, 'rotten_flesh', 10, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        expect(tree.children).toBeDefined();
        expect(tree.children!.variants.length).toBeGreaterThan(0);
        
        const hasHuntChild = tree.children!.variants.some((child: any) => child.value.action === 'hunt');
        const hasMineChild = tree.children!.variants.some((child: any) => child.value.action === 'mine');
        
        expect(hasHuntChild).toBe(true);   // Hunt path for zombies
        expect(hasMineChild).toBe(false);  // No mining for rotten flesh
    });

    test('rotten_flesh: no paths when no zombies in snapshot', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {},
            entities: {} // No zombies
        };

        const tree = plan(mcData, 'rotten_flesh', 10, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        // Should have no valid paths
        expect(tree.children).toBeDefined();
        expect(tree.children!.variants.length).toBe(0);
    });

    test('enumerated paths should not include hunt actions when entities absent', () => {
        const snapshot = {
            version: '1.20.1',
            dimension: 'overworld',
            center: { x: 0, y: 64, z: 0 },
            radius: 32,
            yMin: -64,
            yMax: 320,
            blocks: {
                bamboo: { count: 50, closestDistance: 5, averageDistance: 10 }
            },
            entities: {} // No pandas
        };

        const tree = plan(mcData, 'bamboo', 10, {
            inventory: {},
            log: false,
            pruneWithWorld: true,
            worldSnapshot: snapshot
        });

        const paths = enumerateActionPaths(tree);
        expect(paths.length).toBeGreaterThan(0);
        
        // No path should contain a hunt action for panda
        for (const path of paths) {
            const hasHuntAction = path.some(step => 
                step.action === 'hunt' && step.what.variants[0].value === 'panda'
            );
            expect(hasHuntAction).toBe(false);
        }
        
        // All paths should only have mine actions
        for (const path of paths) {
            const huntSteps = path.filter(step => step.action === 'hunt');
            expect(huntSteps.length).toBe(0);
        }
    });
});
