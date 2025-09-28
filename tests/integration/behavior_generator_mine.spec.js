const plan = require('../../planner');
const { createBehaviorForStep } = require('../../behavior_generator');

describe('integration: behavior_generator mine', () => {
    const { resolveMcData, enumerateLowestWeightPathsGenerator } = plan._internals;
    const mcData = resolveMcData('1.20.1');

    test('creates behavior for a mine leaf step from planner path', () => {
        const inventory = {};
        const tree = plan(mcData, 'cobblestone', 1, { log: false, inventory });
        const [path] = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory }));
        expect(path).toBeDefined();
        const mineLeaf = path.find(s => s.action === 'mine' && (!s.operator || !s.children || s.children.length === 0));
        expect(mineLeaf).toBeDefined();
        const mc = require('minecraft-data')('1.20.1');
        const bot = { version: '1.20.1', mcData: mc, inventory: { items: () => [], slots: [], firstEmptyInventorySlot: () => 9 }, world: { getBlockType: () => 0 }, entity: { position: { clone: () => ({}) } } };
        const behavior = createBehaviorForStep(bot, mineLeaf);
        expect(behavior).toBeTruthy();
    });
});


