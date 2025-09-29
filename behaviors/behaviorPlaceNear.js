const Vec3 = require('vec3').Vec3;

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BehaviorFindInteractPosition,
    BehaviorMoveTo,
    BehaviorPlaceBlock,
    BehaviorMineBlock
} = require('mineflayer-statemachine')
const createClearAreaState = require('./behaviorClearArea')

function createPlaceNearState(bot, targets) {
    const enter = new BehaviorIdle()

    const findPlaceCoords = new BehaviorFindInteractPosition(bot, targets)

    const moveToPlaceCoords = new BehaviorMoveTo(bot, targets)
    moveToPlaceCoords.distance = 0.05

    const placeBlock = new BehaviorPlaceBlock(bot, targets)
    const clearInit = new BehaviorIdle()
    const clearTargets = { placePosition: null, clearRadiusHorizontal: 1, clearRadiusVertical: 2 }
    const clearArea = createClearAreaState(bot, clearTargets)
    // Ensure the held item matches targets.item before placing (wrap original handler safely)
    const originalOnStateEntered = typeof placeBlock.onStateEntered === 'function' ? placeBlock.onStateEntered.bind(placeBlock) : null
    placeBlock.onStateEntered = async () => {
        try {
            const need = targets && targets.item
            const held = bot.heldItem
            if (need && (!held || held.name !== need.name)) {
                await bot.equip(need, 'hand')
            }
        } catch (_) {}
        if (originalOnStateEntered) return originalOnStateEntered()
    }

    const exit = new BehaviorIdle()

    function getHeadroom() {
        return targets.placePosition.clone().offset(0, 1, 0)
    }
    function isSolidBlock(pos) {
        try {
            const b = bot.blockAt(pos, false)
            if (!b) return false
            if (b.type === 0) return false
            return b.boundingBox === 'block'
        } catch (_) { return false }
    }
    function findSolidBaseNear(pos, maxRadius = 2) {
        const base = pos.clone(); base.x = Math.floor(base.x); base.y = Math.floor(base.y); base.z = Math.floor(base.z)
        let best = null
        for (let r = 0; r <= maxRadius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    const p = base.clone().offset(dx, -1, dz)
                    const above = p.clone().offset(0, 1, 0)
                    if (isSolidBlock(p) && bot.world.getBlockType(above) === 0) {
                        if (!best || p.distanceTo(bot.entity.position) < best.distanceTo(bot.entity.position)) best = p
                    }
                }
            }
            if (best) break
        }
        return best
    }
    function gatherCandidateObstructions() {
        const head = getHeadroom()
        const list = []
        const h = Number.isFinite(targets.clearRadiusHorizontal) ? Math.max(0, Math.floor(targets.clearRadiusHorizontal)) : 1
        const v = Number.isFinite(targets.clearRadiusVertical) ? Math.max(1, Math.floor(targets.clearRadiusVertical)) : 2
        for (let dy = 0; dy < v; dy++) {
            for (let dx = -h; dx <= h; dx++) for (let dz = -h; dz <= h; dz++) list.push(head.clone().offset(dx, dy, dz))
        }
        return list
    }
    function getObstructionsSorted() {
        const list = gatherCandidateObstructions().filter(p => bot.world.getBlockType(p) !== 0)
        list.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
        try {
            const blocks = list.map(p => bot.blockAt(p, false)).filter(Boolean)
            const visible = blocks.filter(b => typeof bot.canSeeBlock === 'function' ? bot.canSeeBlock(b) : true)
            if (visible.length > 0) return visible.map(b => b.position)
        } catch (_) {}
        return list
    }
    function obstructedDirectionsCount() {
        const head = getHeadroom()
        const obstructed = { E: false, W: false, S: false, N: false }
        const list = gatherCandidateObstructions()
        for (const p of list) {
            if (bot.world.getBlockType(p) === 0) continue
            const dx = p.x - head.x
            const dz = p.z - head.z
            if (Math.abs(dx) >= Math.abs(dz)) {
                if (dx > 0) obstructed.E = true; else if (dx < 0) obstructed.W = true
            } else {
                if (dz > 0) obstructed.S = true; else if (dz < 0) obstructed.N = true
            }
        }
        return (obstructed.E|0) + (obstructed.W|0) + (obstructed.S|0) + (obstructed.N|0)
    }
    function canPlaceNow() {
        return obstructedDirectionsCount() < 2
    }
    function shouldClearArea() {
        return obstructedDirectionsCount() >= 2
    }

    const enterToExit = new StateTransition({
        name: 'BehaviorPlaceNear: enter -> exit',
        parent: enter,
        child: exit,
        shouldTransition: () => targets.item == null,
        onTransition: () => {
            console.log('BehaviorPlaceNear: enter -> exit, item is null')
        }
    })

    let placeTries = 1
    const enterToFindPlaceCoords = new StateTransition({
        name: 'BehaviorPlaceNear: enter -> find place coords',
        parent: enter,
        child: findPlaceCoords,
        shouldTransition: () => true,
        onTransition: () => {
            console.log('BehaviorPlaceNear: enter -> find place coords')
            placeTries = 1
            targets.placedConfirmed = false

            const base = bot.entity.position.clone()
            const offsetX = (Math.random() < 0.5 ? -1.5 : 1.5)
            const offsetZ = (Math.random() < 0.5 ? -1.5 : 1.5)
            const rough = base.clone(); rough.x += offsetX; rough.z += offsetZ
            const ground = findSolidBaseNear(rough) || findSolidBaseNear(base) || findSolidBaseNear(base.offset(0, 0, 0))
            if (ground) {
                const placePos = ground.clone()
                targets.placePosition = placePos
                const center = placePos.clone(); center.x += 0.5; center.y += 1; center.z += 0.5
                targets.position = placePos.clone(); targets.position.x += 0.5; targets.position.y += 0; targets.position.z += 0.5
                console.log('BehaviorPlaceNear: Set place base:', placePos)
                console.log('BehaviorPlaceNear: Set target position:', targets.position)
            } else {
                const fallback = base.floored()
                fallback.y -= 1
                targets.placePosition = fallback
                targets.position = fallback.clone(); targets.position.x += 0.5; targets.position.z += 0.5
                console.log('BehaviorPlaceNear: Fallback place base:', targets.placePosition)
            }
        }
    })

    const findPlaceCoordsToMoveToPlaceCoords = new StateTransition({
        name: 'BehaviorPlaceNear: find place coords -> move to place coords',
        parent: findPlaceCoords,
        child: moveToPlaceCoords,
        shouldTransition: () => true,
        onTransition: () => {
            console.log('BehaviorPlaceNear: find place coords -> move to place coords')
        }
    })

    let placeStartTime
    const moveToPlaceCoordsToPlaceUtilityBlock = new StateTransition({
        name: 'BehaviorPlaceNear: move to place coords -> place block',
        parent: moveToPlaceCoords,
        child: placeBlock,
        shouldTransition: () => {
            if (!moveToPlaceCoords.isFinished()) return false
            if (!canPlaceNow()) return false
            try {
                const ref = bot.blockAt(targets.placePosition, false)
                if (!ref || ref.type === 0) return false
            } catch (_) { return false }
            return true
        },
        onTransition: () => {
            placeStartTime = Date.now()
            console.log('BehaviorPlaceNear: move to place coords -> place block')
            targets.position = targets.placePosition
            targets.blockFace = new Vec3(0, 1, 0)

            targets.placedPosition = targets.position.clone()
            targets.placedPosition.y += 1
            try { targets.referenceBlock = bot.blockAt(targets.placePosition, false) } catch (_) {}
        }
    })

    // Multi-block clear loop delegated to behaviorClearArea
    const moveToPlaceCoordsToClearInit = new StateTransition({
        name: 'BehaviorPlaceNear: move to place coords -> clear init',
        parent: moveToPlaceCoords,
        child: clearInit,
        shouldTransition: () => moveToPlaceCoords.isFinished() && shouldClearArea() && placeTries < 5,
        onTransition: () => {
            clearTargets.placePosition = targets.placePosition.clone()
            clearTargets.clearRadiusHorizontal = Number.isFinite(targets.clearRadiusHorizontal)
                ? targets.clearRadiusHorizontal
                : (Number.isFinite(clearTargets.clearRadiusHorizontal) ? clearTargets.clearRadiusHorizontal : 1)
            clearTargets.clearRadiusVertical = Number.isFinite(targets.clearRadiusVertical)
                ? targets.clearRadiusVertical
                : (Number.isFinite(clearTargets.clearRadiusVertical) ? clearTargets.clearRadiusVertical : 2)
            console.log('BehaviorPlaceNear: clear init -> queued area with radii', clearTargets.clearRadiusHorizontal, clearTargets.clearRadiusVertical)
        }
    })

    const clearInitToClearArea = new StateTransition({
        name: 'BehaviorPlaceNear: clear init -> clear area',
        parent: clearInit,
        child: clearArea,
        shouldTransition: () => !!clearTargets.placePosition,
        onTransition: () => {}
    })

    const clearAreaToPlaceGate = new StateTransition({
        name: 'BehaviorPlaceNear: clear area -> place gate',
        parent: clearArea,
        child: moveToPlaceCoords,
        shouldTransition: () => typeof clearArea.isFinished === 'function' ? clearArea.isFinished() && canPlaceNow() : canPlaceNow(),
        onTransition: () => { console.log('BehaviorPlaceNear: clearing complete') }
    })

    const clearAreaToReposition = new StateTransition({
        name: 'BehaviorPlaceNear: clear area -> reposition',
        parent: clearArea,
        child: findPlaceCoords,
        shouldTransition: () => {
            const finished = typeof clearArea.isFinished === 'function' ? clearArea.isFinished() : true
            return finished && !canPlaceNow()
        },
        onTransition: () => {
            console.log('BehaviorPlaceNear: clearing capped or still obstructed -> reposition')
            placeTries++
        }
    })

    const placeUtilityBlockToFindPlaceCoords = new StateTransition({
        name: 'BehaviorPlaceNear: place block -> find place coords',
        parent: placeBlock,
        child: findPlaceCoords,
        shouldTransition: () => Date.now() - placeStartTime > 1000 && placeTries < 8 && bot.world.getBlockType(targets.placedPosition) === 0,
        onTransition: () => {
            console.log(`BehaviorPlaceNear: place block -> find place coords (retry ${placeTries})`)
            placeTries++
        }
    })

    const placeUtilityBlockToExit = new StateTransition({
        name: 'BehaviorPlaceNear: place block -> exit',
        parent: placeBlock,
        child: exit,
        shouldTransition: () => Date.now() - placeStartTime > 500 && (bot.world.getBlockType(targets.placedPosition) != 0 || placeTries >= 8),
        onTransition: () => {
            console.log('BehaviorPlaceNear: place block -> exit')
            console.log('Block at place position:', bot.world.getBlockType(targets.placedPosition))
            try {
                const blk = bot.blockAt(targets.placedPosition, false)
                targets.placedConfirmed = !!(blk && blk.name)
            } catch (_) { targets.placedConfirmed = false }
        }
    })

    const transitions = [
        enterToExit,
        enterToFindPlaceCoords,
        findPlaceCoordsToMoveToPlaceCoords,
        moveToPlaceCoordsToClearInit,
        clearInitToClearArea,
        clearAreaToPlaceGate,
        moveToPlaceCoordsToPlaceUtilityBlock,
        placeUtilityBlockToFindPlaceCoords,
        placeUtilityBlockToExit,
        clearAreaToReposition
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createPlaceNearState;


