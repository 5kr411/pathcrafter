const plan = require('../../planner');
const { createBehaviorForStep } = require('../../behavior_generator');

describe('integration: behavior_generator mine', () => {
    const { resolveMcData, enumerateLowestWeightPathsGenerator } = plan._internals;
    const mcData = resolveMcData('1.20.1');

    test('creates behavior for a mine leaf step from planner path', () => {
        // Start with tools already available to avoid expensive tree generation
        const inventory = { wooden_pickaxe: 1 };
        const snapshot = {
            version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1,
            blocks: { cobblestone: { count: 10, closestDistance: 5, averageDistance: 10 } },
            entities: {}
        };
        const tree = plan(mcData, 'cobblestone', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
        // Use shortest paths which is much faster
        const { enumerateShortestPathsGenerator } = plan._internals;
        const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory }));
        expect(path).toBeDefined();
        const mineLeaf = path.find(s => s.action === 'mine' && (!s.operator || !s.children || s.children.length === 0));
        expect(mineLeaf).toBeDefined();
        const mc = require('minecraft-data')('1.20.1');
        const bot = { version: '1.20.1', mcData: mc, inventory: { items: () => [], slots: [], firstEmptyInventorySlot: () => 9 }, world: { getBlockType: () => 0 }, entity: { position: { clone: () => ({}) } } };
        const behavior = createBehaviorForStep(bot, mineLeaf);
        expect(behavior).toBeTruthy();
    });
});


