const { parentPort, workerData, isMainThread } = require('worker_threads')

const {
    StateTransition,
    BehaviorIdle,
    BehaviorFollowEntity,
    BehaviorGetClosestEntity,
    NestedStateMachine,
    BehaviorFindBlock,
    BehaviorFindInteractPosition,
    BehaviorMoveTo,
    BehaviorMineBlock,
} = require('mineflayer-statemachine')

const { getItemCountInInventory } = require('../util')

const minecraftData = require('minecraft-data')

let findBlock
const excludedPositionType = 'excludedPosition'

function createCollectBlockState(bot, targets) {
    const mcData = minecraftData(bot.version)
    let initialId = mcData.blocksByName[targets.blockName]?.id
    try {
        console.log(`BehaviorCollectBlock:init -> block=${targets.blockName}#${initialId}, item=${targets.itemName}, amount=${targets.amount}`)
    } catch (_) {}

    const currentBlockCount = getItemCountInInventory(bot, targets.itemName)

    function collectedCount() {
        return getItemCountInInventory(bot, targets.itemName) - currentBlockCount
    }

    const enter = new BehaviorIdle()

    findBlock = new BehaviorFindBlock(bot, targets)
    if (initialId != null) findBlock.blocks = [initialId]
    findBlock.maxDistance = 64

    const findInteractPosition = new BehaviorFindInteractPosition(bot, targets)

    const goToBlock = new BehaviorMoveTo(bot, targets)
    goToBlock.distance = 0.5
    goToBlock.movements.allow1by1towers = true
    goToBlock.movements.canOpenDoors = true
    goToBlock.movements.allowSprinting = true
    goToBlock.movements.canDig = true

    const mineBlock = new BehaviorMineBlock(bot, targets)

    const findDrop = new BehaviorGetClosestEntity(bot, targets, (entity) => {
        return (entity.displayName === 'Item') && entity.position.distanceTo(bot.entity.position) < 8;
    })

    const goToDrop = new BehaviorFollowEntity(bot, targets)

    const exit = new BehaviorIdle()

    const enterToFindBlock = new StateTransition({
        parent: enter,
        child: findBlock,
        name: 'BehaviorCollectBlock: enter -> find block',
        shouldTransition: () => collectedCount() < targets.amount,
        onTransition: () => {
            try {
                const currentId = mcData.blocksByName[targets.blockName]?.id
                if (currentId != null) findBlock.blocks = [currentId]
                console.log(`BehaviorCollectBlock: enter -> find block (target=${targets.blockName}#${currentId})`)
            } catch (_) {
                console.log('BehaviorCollectBlock: enter -> find block')
            }
        }
    })

    const findBlockToExit = new StateTransition({
        parent: findBlock,
        child: exit,
        name: 'BehaviorCollectBlock: find block -> exit',
        shouldTransition: () => targets.position === undefined,
        onTransition: () => {
            console.log('BehaviorCollectBlock: find block -> exit')
        }
    })

    const findBlockToFindInteractPosition = new StateTransition({
        parent: findBlock,
        child: findInteractPosition,
        name: 'BehaviorCollectBlock: find block -> find interact position',
        shouldTransition: () => targets.position !== undefined,
        onTransition: () => {
            targets.blockPosition = targets.position
            console.log('BehaviorCollectBlock: find block -> find interact position')
        }
    })

    let moveStartTime
    const findInteractPositionToGoToBlock = new StateTransition({
        parent: findInteractPosition,
        child: goToBlock,
        name: 'BehaviorCollectBlock: find interact position -> go to block',
        shouldTransition: () => true,
        onTransition: () => {
            moveStartTime = Date.now()
            if (targets.blockPosition) {
                if (!isMainThread && parentPort) {
                    parentPort.postMessage({ from: workerData.username, type: excludedPositionType, data: targets.blockPosition });
                    console.log('BehaviorCollectBlock: Added excluded position -> findBlock because self found: ', targets.blockPosition);
                } else {
                    console.log('BehaviorCollectBlock: Found block position (main thread): ', targets.blockPosition);
                }
                if (findBlock && typeof findBlock.addExcludedPosition === 'function') {
                    findBlock.addExcludedPosition(targets.blockPosition)
                }
                // Ensure movement has a clear goal even if interact position is unavailable
                if (!targets.position) {
                    targets.position = targets.blockPosition
                }
                try {
                    console.log('BehaviorCollectBlock: moving towards position ', targets.position)
                } catch (_) {}
                console.log('BehaviorCollectBlock: find interact position -> go to block')
            }
        }
    })

    const goToBlockToMineBlock = new StateTransition({
        parent: goToBlock,
        child: mineBlock,
        name: 'BehaviorCollectBlock: go to block -> mine block',
        shouldTransition: () => goToBlock.isFinished() && goToBlock.distanceToTarget() < 6,
        onTransition: () => {
            targets.position = targets.blockPosition
            console.log('BehaviorCollectBlock: go to block -> mine block')
        }
    })

    const goToBlockToFindBlock = new StateTransition({
        parent: goToBlock,
        child: findBlock,
        name: 'BehaviorCollectBlock: go to block -> find block',
        shouldTransition: () => goToBlock.isFinished() && goToBlock.distanceToTarget() >= 6,
        onTransition: () => {
            console.log('BehaviorCollectBlock: go to block -> find block')
        }
    })

    let mineBlockFinishTime
    const mineBlockToFindDrop = new StateTransition({
        parent: mineBlock,
        child: findDrop,
        name: 'BehaviorCollectBlock: mine block -> find drop',
        shouldTransition: () => {
            if (mineBlock.isFinished && !mineBlockFinishTime) {
                mineBlockFinishTime = Date.now()
            }
            return Date.now() - mineBlockFinishTime > 500
        },
        onTransition: () => {
            mineBlockFinishTime = undefined
            try {
                const t = targets.blockPosition
                const type = t ? bot.world.getBlockType(t) : undefined
                console.log('BehaviorCollectBlock: mine block -> find drop (post-mine blockType=', type, ')')
            } catch (_) {
                console.log('BehaviorCollectBlock: mine block -> find drop')
            }
        }
    })

    let goToBlockStartTime
    const findDropToGoToDrop = new StateTransition({
        parent: findDrop,
        child: goToDrop,
        name: 'BehaviorCollectBlock: find drop -> go to drop',
        shouldTransition: () => targets.entity !== null,
        onTransition: () => {
            goToBlockStartTime = Date.now()
            try {
                const pos = targets.entity && targets.entity.position
                const dist = pos ? pos.distanceTo(bot.entity.position).toFixed(2) : 'n/a'
                console.log('BehaviorCollectBlock: find drop -> go to drop at', pos, 'dist', dist)
            } catch (_) {
                console.log('BehaviorCollectBlock: find drop -> go to drop')
            }
        }
    })

    const findDropToFindBlock = new StateTransition({
        parent: findDrop,
        child: findBlock,
        name: 'BehaviorCollectBlock: find drop -> find block',
        shouldTransition: () => targets.entity === null,
        onTransition: () => {
            try {
                const items = Object.values(bot.entities || {}).filter(e => e.displayName === 'Item')
                console.log('BehaviorCollectBlock: find drop -> find block (no nearby items). Nearby items count=', items.length)
            } catch (_) {
                console.log('BehaviorCollectBlock: find drop -> find block')
            }
        }
    })

    const goToDropToFindBlock = new StateTransition({
        parent: goToDrop,
        child: findBlock,
        name: 'BehaviorCollectBlock: go to drop -> find block',
        shouldTransition: () => (goToDrop.distanceToTarget() <= 0.75 || Date.now() - goToBlockStartTime > 5000) && collectedCount() < targets.amount,
        onTransition: () => {
            console.log('BehaviorCollectBlock: go to drop -> find block: ', Date.now() - goToBlockStartTime)
            console.log(`BehaviorCollectBlock: Blocks collected:  ${collectedCount()}/${targets.amount} ${targets.itemName}`)
        }
    })

    const goToDropToExit = new StateTransition({
        parent: goToDrop,
        child: exit,
        name: 'BehaviorCollectBlock: go to drop -> exit',
        shouldTransition: () => (goToDrop.distanceToTarget() <= 0.75 && Date.now() - goToBlockStartTime > 1000) || (collectedCount() >= targets.amount && Date.now() - goToBlockStartTime > 1000),
        onTransition: () => {
            console.log(`BehaviorCollectBlock: go to drop -> exit: ${collectedCount()}/${targets.amount} ${targets.itemName} collected, ${getItemCountInInventory(bot, targets.itemName)} total`)
        }
    })

    const transitions = [
        enterToFindBlock,
        findBlockToExit,
        findBlockToFindInteractPosition,
        findInteractPositionToGoToBlock,
        goToBlockToMineBlock,
        goToBlockToFindBlock,
        mineBlockToFindDrop,
        findDropToGoToDrop,
        findDropToFindBlock,
        goToDropToFindBlock,
        goToDropToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCollectBlockState


