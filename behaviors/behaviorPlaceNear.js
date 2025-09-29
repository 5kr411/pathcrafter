const Vec3 = require('vec3').Vec3;

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BehaviorFindInteractPosition,
    BehaviorMoveTo,
    BehaviorPlaceBlock
} = require('mineflayer-statemachine')

function createPlaceNearState(bot, targets) {
    const enter = new BehaviorIdle()

    const findPlaceCoords = new BehaviorFindInteractPosition(bot, targets)

    const moveToPlaceCoords = new BehaviorMoveTo(bot, targets)
    moveToPlaceCoords.distance = 0.05

    const placeBlock = new BehaviorPlaceBlock(bot, targets)
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

            targets.position = bot.entity.position
            targets.position.x = Math.floor(targets.position.x) + 0.5
            targets.position.y = Math.floor(targets.position.y) - 1
            targets.position.z = Math.floor(targets.position.z) + 0.5
            targets.placePosition = targets.position.clone();
            console.log('BehaviorPlaceNear: Set place position:', targets.placePosition)

            targets.position.x += Math.random() < 0.5 ? -1.5 : 1.5;
            targets.position.z += Math.random() < 0.5 ? -1.5 : 1.5;
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
        shouldTransition: () => moveToPlaceCoords.isFinished(),
        onTransition: () => {
            placeStartTime = Date.now()
            console.log('BehaviorPlaceNear: move to place coords -> place block')
            targets.position = targets.placePosition
            targets.blockFace = new Vec3(0, 1, 0)

            targets.placedPosition = targets.position.clone()
            targets.placedPosition.y += 1
        }
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
        }
    })

    const transitions = [
        enterToExit,
        enterToFindPlaceCoords,
        findPlaceCoordsToMoveToPlaceCoords,
        moveToPlaceCoordsToPlaceUtilityBlock,
        placeUtilityBlockToFindPlaceCoords,
        placeUtilityBlockToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createPlaceNearState;


