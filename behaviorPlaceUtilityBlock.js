const Vec3 = require('vec3').Vec3;

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BehaviorFindInteractPosition,
    BehaviorMoveTo,
    BehaviorPlaceBlock
} = require('mineflayer-statemachine')

function createPlaceUtilityBlockState(bot, targets) {
    const enter = new BehaviorIdle()

    const findPlaceCoords = new BehaviorFindInteractPosition(bot, targets)

    const moveToPlaceCoords = new BehaviorMoveTo(bot, targets)
    moveToPlaceCoords.distance = 0.05

    const placeUtilityBlock = new BehaviorPlaceBlock(bot, targets)

    const exit = new BehaviorIdle()

    let placeTries = 1
    const enterToFindPlaceCoords = new StateTransition({
        name: 'main: enter -> find place coords',
        parent: enter,
        child: findPlaceCoords,
        shouldTransition: () => true,
        onTransition: () => {
            console.log('main: enter -> find place coords')
            placeTries = 1

            targets.position = bot.entity.position
            targets.position.x = Math.floor(targets.position.x) + 0.5
            targets.position.y = Math.floor(targets.position.y) - 1
            targets.position.z = Math.floor(targets.position.z) + 0.5
            targets.placePosition = targets.position.clone();
            console.log('Set place position:', targets.placePosition)

            targets.position.x += Math.random() < 0.5 ? -1.5 : 1.5;
            targets.position.z += Math.random() < 0.5 ? -1.5 : 1.5;
            console.log('Set target position:', targets.position)
        }
    })

    const findPlaceCoordsToMoveToPlaceCoords = new StateTransition({
        name: 'main: find place coords -> move to place coords',
        parent: findPlaceCoords,
        child: moveToPlaceCoords,
        shouldTransition: () => true,
        onTransition: () => {
            console.log('main: find place coords -> move to place coords')
        }
    })

    let placeStartTime
    const moveToPlaceCoordsToPlaceUtilityBlock = new StateTransition({
        name: 'main: move to place coords -> place utility block',
        parent: moveToPlaceCoords,
        child: placeUtilityBlock,
        shouldTransition: () => moveToPlaceCoords.isFinished(),
        onTransition: () => {
            placeStartTime = Date.now()
            console.log('main: move to place coords -> place utility block')
            targets.position = targets.placePosition
            targets.blockFace = new Vec3(0, 1, 0)

            targets.placedPosition = targets.position.clone()
            targets.placedPosition.y += 1
        }
    })

    const placeUtilityBlockToFindPlaceCoords = new StateTransition({
        name: 'main: place utility block -> find place coords',
        parent: placeUtilityBlock,
        child: findPlaceCoords,
        shouldTransition: () => Date.now() - placeStartTime > 1000 && placeTries < 5 && bot.world.getBlockType(targets.placedPosition) === 0,
        onTransition: () => {
            console.log(`main: place utility block -> find place coords (retry ${placeTries})`)
            placeTries++
        }
    })

    const placeUtilityBlockToExit = new StateTransition({
        name: 'main: place utility block -> exit',
        parent: placeUtilityBlock,
        child: exit,
        shouldTransition: () => Date.now() - placeStartTime > 1000 && (bot.world.getBlockType(targets.placedPosition) != 0 || placeTries >= 5),
        onTransition: () => {
            console.log('main: place utility block -> exit')
            console.log('Block at place position:', bot.world.getBlockType(targets.placedPosition))
        }
    })

    const transitions = [
        enterToFindPlaceCoords,
        findPlaceCoordsToMoveToPlaceCoords,
        moveToPlaceCoordsToPlaceUtilityBlock,
        placeUtilityBlockToFindPlaceCoords,
        placeUtilityBlockToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createPlaceUtilityBlockState;