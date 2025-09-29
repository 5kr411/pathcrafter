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
    function gatherCandidateObstructions() {
        const head = getHeadroom()
        const list = []
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) list.push(head.clone().offset(dx, dy, dz))
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
    function isAreaClear() {
        return gatherCandidateObstructions().every(p => bot.world.getBlockType(p) === 0)
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
            const target = base.clone(); target.x += offsetX; target.z += offsetZ
            const placePos = target.clone()
            placePos.x = Math.floor(placePos.x) + 0.5
            placePos.y = Math.floor(placePos.y) - 1
            placePos.z = Math.floor(placePos.z) + 0.5
            targets.placePosition = placePos.clone();
            targets.position = target
            console.log('BehaviorPlaceNear: Set place position:', targets.placePosition)
            console.log('BehaviorPlaceNear: Set target position:', targets.position)
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
        shouldTransition: () => moveToPlaceCoords.isFinished() && isAreaClear(),
        onTransition: () => {
            placeStartTime = Date.now()
            console.log('BehaviorPlaceNear: move to place coords -> place block')
            targets.position = targets.placePosition
            targets.blockFace = new Vec3(0, 1, 0)

            targets.placedPosition = targets.position.clone()
            targets.placedPosition.y += 1
        }
    })

    // Multi-block clear loop delegated to behaviorClearArea
    const moveToPlaceCoordsToClearInit = new StateTransition({
        name: 'BehaviorPlaceNear: move to place coords -> clear init',
        parent: moveToPlaceCoords,
        child: clearInit,
        shouldTransition: () => moveToPlaceCoords.isFinished() && !isAreaClear() && placeTries < 3,
        onTransition: () => {
            clearTargets.placePosition = targets.placePosition.clone()
            clearTargets.clearRadiusHorizontal = Number.isFinite(targets.clearRadiusHorizontal) ? targets.clearRadiusHorizontal : 2
            clearTargets.clearRadiusVertical = Number.isFinite(targets.clearRadiusVertical) ? targets.clearRadiusVertical : 2
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
        shouldTransition: () => typeof clearArea.isFinished === 'function' ? clearArea.isFinished() && isAreaClear() : isAreaClear(),
        onTransition: () => { console.log('BehaviorPlaceNear: clearing complete') }
    })

    const placeUtilityBlockToFindPlaceCoords = new StateTransition({
        name: 'BehaviorPlaceNear: place block -> find place coords',
        parent: placeBlock,
        child: findPlaceCoords,
        shouldTransition: () => Date.now() - placeStartTime > 1000 && placeTries < 5 && bot.world.getBlockType(targets.placedPosition) === 0,
        onTransition: () => {
            console.log(`BehaviorPlaceNear: place block -> find place coords (retry ${placeTries})`)
            placeTries++
        }
    })

    const placeUtilityBlockToExit = new StateTransition({
        name: 'BehaviorPlaceNear: place block -> exit',
        parent: placeBlock,
        child: exit,
        shouldTransition: () => Date.now() - placeStartTime > 500 && (bot.world.getBlockType(targets.placedPosition) != 0 || placeTries >= 5),
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
        placeUtilityBlockToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createPlaceNearState;


