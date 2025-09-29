const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')
const createBreakAtPositionState = require('./behaviorBreakAtPosition')

function createClearAreaState(bot, targets) {
    const enter = new BehaviorIdle()
    const init = new BehaviorIdle()
    const awaitConfirm = new BehaviorIdle()
    const breakTargets = { position: null }
    const breaker = createBreakAtPositionState(bot, breakTargets)
    const exit = new BehaviorIdle()

    function getPlacePosition() {
        return targets.placePosition && targets.placePosition.clone ? targets.placePosition.clone() : null
    }

    function gatherObstructions() {
        const base = getPlacePosition()
        if (!base) return []
        const h = Number.isFinite(targets.clearRadiusHorizontal) ? Math.max(0, Math.floor(targets.clearRadiusHorizontal)) : 2
        const v = Number.isFinite(targets.clearRadiusVertical) ? Math.max(1, Math.floor(targets.clearRadiusVertical)) : 2
        const head = base.offset(0, 1, 0)
        const list = []
        for (let dy = 0; dy < v; dy++) {
            for (let dx = -h; dx <= h; dx++) for (let dz = -h; dz <= h; dz++) list.push(head.clone().offset(dx, dy, dz))
        }
        return list
    }
    function isAreaClear() {
        return gatherObstructions().every(p => bot.world.getBlockType(p) === 0)
    }
    function sortedObstructions() {
        const positions = gatherObstructions().filter(p => bot.world.getBlockType(p) !== 0)
        positions.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
        try {
            const blocks = positions.map(p => bot.blockAt(p, false)).filter(Boolean)
            // Prefer blocks that are both visible and diggable with current tools
            const preferred = blocks.filter(b => {
                const vis = (typeof bot.canSeeBlock === 'function') ? bot.canSeeBlock(b) : true
                const dig = (typeof bot.canDigBlock === 'function') ? bot.canDigBlock(b) : true
                return vis && dig
            })
            if (preferred.length > 0) return preferred.map(b => b.position)
            // Fallback: any diggable
            const diggable = blocks.filter(b => (typeof bot.canDigBlock === 'function') ? bot.canDigBlock(b) : true)
            if (diggable.length > 0) return diggable.map(b => b.position)
        } catch (_) {}
        // If none are diggable, return empty to avoid futile attempts
        return []
    }

    let queue = []
    let idx = 0
    let current = null
    let startTime = 0

    const enterToExit = new StateTransition({
        name: 'ClearArea: enter -> exit (no placePosition)',
        parent: enter,
        child: exit,
        shouldTransition: () => !getPlacePosition(),
        onTransition: () => {}
    })

    const enterToInit = new StateTransition({
        name: 'ClearArea: enter -> init',
        parent: enter,
        child: init,
        shouldTransition: () => !!getPlacePosition(),
        onTransition: () => {
            queue = sortedObstructions().slice(0, 48)
            idx = 0
        }
    })

    const initToExit = new StateTransition({
        name: 'ClearArea: init -> exit (already clear)',
        parent: init,
        child: exit,
        shouldTransition: () => queue.length === 0 || isAreaClear(),
        onTransition: () => {}
    })

    const initToBreak = new StateTransition({
        name: 'ClearArea: init -> break',
        parent: init,
        child: breaker,
        shouldTransition: () => idx < queue.length,
        onTransition: () => {
            while (idx < queue.length && bot.world.getBlockType(queue[idx]) === 0) idx++
            if (idx < queue.length) {
                current = queue[idx]
                breakTargets.position = current
                startTime = Date.now()
            }
        }
    })

    const breakToAwait = new StateTransition({
        name: 'ClearArea: break -> await',
        parent: breaker,
        child: awaitConfirm,
        shouldTransition: () => typeof breaker.isFinished === 'function' ? breaker.isFinished() : true,
        onTransition: () => {}
    })

    const awaitToInit = new StateTransition({
        name: 'ClearArea: await -> init',
        parent: awaitConfirm,
        child: init,
        shouldTransition: () => {
            const removed = current && bot.world.getBlockType(current) === 0
            const timed = Date.now() - startTime > 2500
            return removed || timed
        },
        onTransition: () => {
            idx++
            current = null
            if (idx >= queue.length && !isAreaClear()) {
                queue = sortedObstructions().slice(0, 48)
                idx = 0
            }
        }
    })

    const transitions = [
        enterToExit,
        enterToInit,
        initToExit,
        initToBreak,
        breakToAwait,
        awaitToInit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createClearAreaState


