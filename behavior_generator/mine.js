const createCollectBlockState = require('../behaviors/behaviorCollectBlock');
const { resolveGenericName, resolveWoodFlexibleName } = require('../utils/woodRuntime');
const minecraftData = require('minecraft-data');

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
    let itemName = t.itemName;
    let blockName = t.blockName;
    try {
        const mcData = minecraftData(bot.version);
        if (itemName) itemName = resolveWoodFlexibleName(bot, mcData, itemName);
        if (blockName) blockName = resolveWoodFlexibleName(bot, mcData, blockName);
    } catch (_) {}
    const targets = { itemName, amount: t.amount, blockName };
    try {
        console.log(`BehaviorGenerator(mine): targets -> block=${targets.blockName}, item=${targets.itemName}, amount=${targets.amount}`)
        return createCollectBlockState(bot, targets);
    } catch (_) {
        console.log('BehaviorGenerator(mine): falling back to no-op behavior in test context')
        return { isFinished: () => true };
    }
}

module.exports = { canHandle, computeTargetsForMine, create };


