const createMineOneOfState = require('../behaviors/behaviorMineOneOf')

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
    return createMineOneOfState(bot, { candidates: t.candidates, amount: t.amount })
}

module.exports = { canHandle, computeTargetsForMineOneOf, create }




