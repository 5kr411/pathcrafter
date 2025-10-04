import { ActionStep } from '../../action_tree/types';
import plan from '../../planner';
import { createBehaviorForStep } from '../../behavior_generator';

describe('integration: behavior_generator mine', () => {
    const { resolveMcData } = (plan as any)._internals;
    const mcData = resolveMcData('1.20.1');

    test('creates behavior for a mine leaf step from planner path', () => {
        // Start with tools already available to avoid expensive tree generation
        const inventory = { wooden_pickaxe: 1 };
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
            blocks: { cobblestone: { count: 10, closestDistance: 5, averageDistance: 10 } },
            entities: {}
        };
        const tree = plan(mcData, 'cobblestone', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Use shortest paths which is much faster
        const { enumerateShortestPathsGenerator } = (plan as any)._internals;
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory })) as ActionStep[][];
        expect(path).toBeDefined();
        const mineLeaf = path.find((s: any) => s.action === 'mine' && (!s.operator || !s.children || s.children.length === 0));
        expect(mineLeaf).toBeDefined();
        const mc = require('minecraft-data')('1.20.1');
        const bot = { 
            version: '1.20.1', 
            mcData: mc, 
            inventory: { 
                items: () => [], 
                slots: [], 
                firstEmptyInventorySlot: () => 9 
            }, 
            world: { 
                getBlockType: () => 0 
            }, 
            entity: { 
                position: { 
                    clone: () => ({}) 
                } 
            } 
        } as any;
        const behavior = createBehaviorForStep(bot, mineLeaf!);
        expect(behavior).toBeTruthy();
    });
});

