const createCollectBlockState = require('../behaviors/behaviorCollectBlock');

function canHandle(step) {
    // Accept direct mine steps with concrete block names (leaf mine actions under OR groups)
    return !!step && step.action === 'mine' && typeof step.what === 'string' && (!step.operator || !step.children || step.children.length === 0);
}

function computeTargetsForMine(step) {
    if (!canHandle(step)) return null;
    // If step has a targetItem, we want that item name in inventory; otherwise, mining the block drops itself
    const itemName = step.targetItem ? step.targetItem : step.what;
    const amount = Number(step.count || 1);
    if (!itemName || amount <= 0) return null;
    return { itemName, amount, blockName: step.what };
}

function create(bot, step) {
    const t = computeTargetsForMine(step);
    if (!t) return null;
    const targets = { itemName: t.itemName, amount: t.amount, blockName: t.blockName };
    try {
        return createCollectBlockState(bot, targets);
    } catch (_) {
        return { isFinished: () => true };
    }
}

module.exports = { canHandle, computeTargetsForMine, create };


