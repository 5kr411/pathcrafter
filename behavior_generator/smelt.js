const minecraftData = require('minecraft-data')
const createSmeltState = require('../behaviors/behaviorSmelt')

function canHandle(step) {
    return !!step && step.action === 'smelt'
}

function computeTargetsForSmelt(step) {
    if (!canHandle(step)) return null
    const itemName = step.result && step.result.item ? step.result.item : null
    const amount = Number(step.count || 1)
    const inputName = step.input && step.input.item ? step.input.item : null
    const fuelName = step.fuel || 'coal'
    if (!itemName || amount <= 0) return null
    return { itemName, amount, inputName, fuelName }
}

function create(bot, step) {
    const targets = computeTargetsForSmelt(step)
    if (!targets) return null
    try {
        return createSmeltState(bot, targets)
    } catch (_) {
        return { isFinished: () => true }
    }
}

module.exports = { canHandle, computeTargetsForSmelt, create }


