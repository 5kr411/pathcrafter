const craftInventory = require('./craftInventory');
const craftTable = require('./craftTable');
const mine = require('./mine');

const ACTION_HANDLERS = [
    craftInventory,
    craftTable,
    mine
];

function createBehaviorForStep(bot, step) {
    if (!step || !step.action) return null;
    for (const handler of ACTION_HANDLERS) {
        if (handler.canHandle(step)) return handler.create(bot, step);
    }
    return null;
}

module.exports = { createBehaviorForStep, _internals: { computeTargetsForCraftInInventory: craftInventory.computeTargetsForCraftInInventory, computeTargetsForCraftInTable: craftTable.computeTargetsForCraftInTable, computeTargetsForMine: mine.computeTargetsForMine } };


