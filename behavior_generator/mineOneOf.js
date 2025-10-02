const createMineOneOfState = require('../behaviors/behaviorMineOneOf')
const minecraftData = require('minecraft-data')
const { resolveWoodFlexibleName } = require('../utils/woodRuntime')

function canHandle(step) {
    if (!step || step.action !== 'mine') return false
    const meta = step.meta
    return !!(meta && Array.isArray(meta.oneOfCandidates) && meta.oneOfCandidates.length > 0)
}

function computeTargetsForMineOneOf(step) {
    if (!canHandle(step)) return null
    const amount = Number(step.count || 1)
    const itemName = step.targetItem ? step.targetItem : step.what
    const rawCandidates = step.meta.oneOfCandidates || []
    const candidates = rawCandidates
        .map(c => {
            if (!c) return null
            const blockName = c.blockName || c.what || c.block
            if (!blockName) return null
            return { blockName, itemName: itemName || blockName, amount }
        })
        .filter(Boolean)
    if (candidates.length === 0) return null
    return { candidates, amount }
}

function create(bot, step) {
    const t = computeTargetsForMineOneOf(step)
    if (!t) return null
    // Resolve flexible wood names for target item if generic/species-agnostic
    try {
        const mcData = minecraftData(bot.version)
        const resolvedCandidates = t.candidates.map(c => {
            const item = c.itemName ? resolveWoodFlexibleName(bot, mcData, c.itemName) : c.itemName
            const block = c.blockName ? resolveWoodFlexibleName(bot, mcData, c.blockName) : c.blockName
            const out = { ...c, itemName: item, blockName: block }
            return out
        })
        return createMineOneOfState(bot, { candidates: resolvedCandidates, amount: t.amount })
    } catch (_) {
        return createMineOneOfState(bot, { candidates: t.candidates, amount: t.amount })
    }
}

module.exports = { canHandle, computeTargetsForMineOneOf, create }




