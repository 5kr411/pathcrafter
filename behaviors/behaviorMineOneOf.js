const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')

const minecraftData = require('minecraft-data')
const logger = require('../utils/logger')

const createCollectBlockState = require('./behaviorCollectBlock')
const { setCurrentSpeciesContext } = require('../utils/context')

function dist2(a, b) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const dz = a.z - b.z
    return dx * dx + dy * dy + dz * dz
}

function createMineOneOfState(bot, targets) {
    // targets: { candidates: [{ blockName, itemName, amount }], amount? }
    const enter = new BehaviorIdle()
    const prepare = new BehaviorIdle()
    const exit = new BehaviorIdle()

    const mcData = (() => { try { return minecraftData(bot.version) } catch (_) { return null } })()

    const selection = { chosen: null }

    function evaluateCandidate(blockName, required) {
        try {
            if (!bot || typeof bot.findBlocks !== 'function') return { count: 0, nearest: Number.POSITIVE_INFINITY }
            const radius = (() => {
                try {
                    const { getLastSnapshotRadius } = require('../utils/context')
                    const r = Number(getLastSnapshotRadius && getLastSnapshotRadius())
                    if (Number.isFinite(r) && r > 0) return r
                } catch (_) {}
                return 64
            })()
            const maxCount = Math.max(required || 1, 32)
            // Prefer fast ID-based matching when available
            const id = mcData && mcData.blocksByName && mcData.blocksByName[blockName] ? mcData.blocksByName[blockName].id : null
            const matcher = (id != null) ? id : ((b) => (b && b.name === blockName))
            const positions = bot.findBlocks({ matching: matcher, maxDistance: radius, count: maxCount }) || []
            let near = Number.POSITIVE_INFINITY
            const center = bot.entity && bot.entity.position ? bot.entity.position : { x: 0, y: 0, z: 0 }
            for (const p of positions) {
                const d2 = dist2(center, p)
                if (d2 < near) near = d2
            }
            return { count: positions.length, nearest: near }
        } catch (_) { return { count: 0, nearest: Number.POSITIVE_INFINITY } }
    }

    // Prepare a dynamic collect behavior whose targets we mutate at runtime
    const dynamicTargets = { blockName: null, itemName: null, amount: 0 }
    let collectBehavior = null
    try {
        collectBehavior = createCollectBlockState(bot, dynamicTargets)
    } catch (_) {
        collectBehavior = null
    }

    function selectBestCandidate() {
        const list = Array.isArray(targets && targets.candidates) ? targets.candidates : []
        if (list.length === 0) return null
        const required = Number(targets.amount || list[0].amount || 1)

        let best = null
        let bestNear = Number.POSITIVE_INFINITY

        // First pass: only those with enough supply
        for (const c of list) {
            if (!c || !c.blockName) continue
            const evalRes = evaluateCandidate(c.blockName, required)
            if (evalRes.count >= required) {
                if (evalRes.nearest < bestNear) {
                    bestNear = evalRes.nearest
                    best = { ...c, eval: evalRes }
                } else if (evalRes.nearest === bestNear && best) {
                    // tie-breaker: higher count available
                    if ((evalRes.count || 0) > (best.eval && best.eval.count || 0)) {
                        best = { ...c, eval: evalRes }
                    }
                }
            }
        }

        // Fallback pass: pick the one with the highest count, then nearest
        if (!best) {
            let bestCount = -1
            bestNear = Number.POSITIVE_INFINITY
            for (const c of list) {
                const evalRes = evaluateCandidate(c.blockName, required)
                if ((evalRes.count || 0) > bestCount || ((evalRes.count || 0) === bestCount && evalRes.nearest < bestNear)) {
                    bestCount = evalRes.count || 0
                    bestNear = evalRes.nearest
                    best = { ...c, eval: evalRes }
                }
            }
        }

        if (!best) return null

        // Set wood species context if applicable (e.g., oak_log -> oak)
        try {
            const n = String(best.blockName || '')
            if (n.endsWith('_log')) {
                const idx = n.lastIndexOf('_')
                if (idx > 0) {
                    const species = n.slice(0, idx)
                    setCurrentSpeciesContext(species)
                }
            }
        } catch (_) {}

        // Normalize target item name: default to blockName when missing
        const itemName = best.itemName || best.blockName
        const amount = Number(best.amount || required || 1)
        selection.chosen = { blockName: best.blockName, itemName, amount }
        return selection.chosen
    }

    // In simple environments (tests), if we could not construct collect behavior, return a trivial behavior
    if (!collectBehavior) {
        const noop = new BehaviorIdle()
        const t0 = new StateTransition({ parent: enter, child: noop, name: 'mine-one-of: enter -> noop', shouldTransition: () => true })
        const t0b = new StateTransition({ parent: noop, child: exit, name: 'mine-one-of: noop -> exit', shouldTransition: () => true })
        return new NestedStateMachine([t0, t0b], enter, exit)
    }

    const tEnterToPrepare = new StateTransition({ parent: enter, child: prepare, name: 'mine-one-of: enter -> prepare', shouldTransition: () => true, onTransition: () => {
        try { logger.debug('preparing selection...') } catch (_) {}
        // Compute selection now based on current targets
        selection.chosen = null
        const chosen = selectBestCandidate()
        if (chosen) selection.chosen = chosen
    } })

    const tPrepareToCollect = new StateTransition({ parent: prepare, child: collectBehavior, name: 'mine-one-of: prepare -> collect', shouldTransition: () => !!selection.chosen, onTransition: () => {
        // Fill dynamic targets just-in-time prior to collect state run
        if (selection.chosen) {
            dynamicTargets.blockName = selection.chosen.blockName
            dynamicTargets.itemName = selection.chosen.itemName
            dynamicTargets.amount = selection.chosen.amount
            try { logger.info(`selected ${dynamicTargets.blockName} for ${dynamicTargets.itemName} x${dynamicTargets.amount}`) } catch (_) {}
        }
    } })

    const tPrepareToExit = new StateTransition({ parent: prepare, child: exit, name: 'mine-one-of: prepare -> exit (no selection)', shouldTransition: () => !selection || !selection.chosen, onTransition: () => {
        try { logger.error('BehaviorMineOneOf: no viable candidate found; exiting') } catch (_) {}
    } })

    const tCollectToExit = new StateTransition({ parent: collectBehavior, child: exit, name: 'mine-one-of: collect -> exit', shouldTransition: () => typeof collectBehavior.isFinished === 'function' ? collectBehavior.isFinished() : true })

    return new NestedStateMachine([tEnterToPrepare, tPrepareToCollect, tPrepareToExit, tCollectToExit], enter, exit)
}

module.exports = createMineOneOfState




