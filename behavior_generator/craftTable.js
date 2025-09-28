const createPlaceNearState = require('../behaviors/behaviorPlaceNear');
const createCraftWithTableState = require('../behaviors/behaviorCraftWithTable');
const createBreakAtPositionState = require('../behaviors/behaviorBreakAtPosition');

function canHandle(step) {
    return !!step && step.action === 'craft' && step.what === 'table';
}

function computeTargetsForCraftInTable(step) {
    if (!canHandle(step)) return null;
    const itemName = step.result && step.result.item ? step.result.item : null;
    const perCraftCount = step.result && step.result.perCraftCount ? step.result.perCraftCount : 1;
    const total = Number(step.count || 1) * perCraftCount;
    if (!itemName || total <= 0) return null;
    return { itemName, amount: total };
}

// Builds a nested state machine: place table -> craft at table -> exit (breaking table is handled by caller/cleanup behavior if desired)
function create(bot, step) {
    const targets = computeTargetsForCraftInTable(step);
    if (!targets) return null;

    // Place crafting_table near bot first
    const placeTargets = { item: { name: 'crafting_table' } };
    let placeTable;
    try {
        placeTable = createPlaceNearState(bot, placeTargets);
    } catch (_) {
        placeTable = { isFinished: () => true };
    }

    // Craft with table once present
    const craftTargets = { itemName: targets.itemName, amount: targets.amount };
    let craftWithTable;
    try {
        craftWithTable = createCraftWithTableState(bot, craftTargets);
    } catch (_) {
        craftWithTable = { isFinished: () => true };
    }

    // Break the table after crafting to return world to prior state
    const breakTargets = { position: null };
    let breakTable;
    try {
        breakTable = createBreakAtPositionState(bot, breakTargets);
    } catch (_) {
        breakTable = { isFinished: () => true };
    }

    // Connect positions after placement
    const seq = {
        type: 'sequence',
        states: [placeTable, craftWithTable, breakTable],
        isFinished() {
            return breakTable && typeof breakTable.isFinished === 'function' ? breakTable.isFinished() : true;
        }
    };

    // Provide a simple hook to propagate placed position to breaker
    // Consumers can set break position using the placeTargets.placedPosition set by BehaviorPlaceNear
    Object.defineProperty(seq, 'setBreakPositionFromPlace', {
        value: function() {
            if (placeTargets && placeTargets.placedPosition) {
                breakTargets.position = placeTargets.placedPosition.clone();
            }
        }
    });

    return seq;
}

module.exports = { canHandle, computeTargetsForCraftInTable, create };


