const createCraftNoTableState = require('../behaviors/behaviorCraftNoTable');
const { resolveWoodFlexibleName } = require('../utils/woodRuntime');
const minecraftData = require('minecraft-data');

function canHandle(step) {
    return !!step && step.action === 'craft' && step.what === 'inventory';
}

function computeTargetsForCraftInInventory(step) {
    if (!canHandle(step)) return null;
    const itemName = step.result && step.result.item ? step.result.item : null;
    const perCraftCount = step.result && step.result.perCraftCount ? step.result.perCraftCount : 1;
    const total = Number(step.count || 1) * perCraftCount;
    if (!itemName || total <= 0) return null;
    return { itemName, amount: total };
}

function create(bot, step) {
    const targets = computeTargetsForCraftInInventory(step);
    if (!targets) return null;
    try {
        const mcData = minecraftData(bot.version);
        if (targets.itemName) targets.itemName = resolveWoodFlexibleName(bot, mcData, targets.itemName);
    } catch (_) {}
    return createCraftNoTableState(bot, targets);
}

module.exports = { canHandle, computeTargetsForCraftInInventory, create };


