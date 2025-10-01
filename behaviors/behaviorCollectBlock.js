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
	BehaviorEquipItem,
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

    // Prefer safe find behavior which avoids looping over repeated positions
    let createSafeFind
    try { createSafeFind = require('./behaviorSafeFindBlock') } catch (_) { createSafeFind = null }
    findBlock = createSafeFind ? createSafeFind(bot, targets) : new BehaviorFindBlock(bot, targets)
    if (initialId != null) findBlock.blocks = [initialId]
    try {
        const { getLastSnapshotRadius } = require('../utils/context')
        const r = Number(getLastSnapshotRadius && getLastSnapshotRadius())
        if (Number.isFinite(r) && r > 0) {
            findBlock.maxDistance = r
        } else {
            findBlock.maxDistance = 64
        }
    } catch (_) {
        findBlock.maxDistance = 64
    }

    const findInteractPosition = new BehaviorFindInteractPosition(bot, targets)

	const goToBlock = new BehaviorMoveTo(bot, targets)
    goToBlock.distance = 0.5
    goToBlock.movements.allow1by1towers = true
    goToBlock.movements.canOpenDoors = true
    goToBlock.movements.allowSprinting = true
    goToBlock.movements.canDig = true

	const equipTargets = { item: null }
	const equipBestTool = new BehaviorEquipItem(bot, equipTargets)

    const mineBlock = new BehaviorMineBlock(bot, targets)
	function pickBestToolItemForBlock(bot, blockName) {
		try {
			const blockInfo = mcData.blocksByName[blockName]
			const items = bot.inventory?.items?.() || []
			const allowed = blockInfo && blockInfo.harvestTools ? new Set(Object.keys(blockInfo.harvestTools).map(id => Number(id))) : null
			if (!allowed || allowed.size === 0) return null
			let best = null
			let bestScore = -1
			for (const it of items) {
				if (!it || typeof it.type !== 'number') continue
				if (!allowed.has(it.type)) continue
				const meta = mcData.itemsById[it.type]
				const score = meta && Number.isFinite(meta.maxDurability) ? meta.maxDurability : 0
				if (score > bestScore) { best = it; bestScore = score }
			}
			return best
		} catch (_) { return null }
	}


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
                // Keep search radius in sync with snapshot radius on each entry
                try {
                    const { getLastSnapshotRadius } = require('../utils/context')
                    const r = Number(getLastSnapshotRadius && getLastSnapshotRadius())
                    if (Number.isFinite(r) && r > 0) findBlock.maxDistance = r
                } catch (_) {}
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

	const goToBlockToEquip = new StateTransition({
        parent: goToBlock,
		child: equipBestTool,
		name: 'BehaviorCollectBlock: go to block -> equip best tool',
        shouldTransition: () => goToBlock.isFinished() && goToBlock.distanceToTarget() < 6,
        onTransition: () => {
            targets.position = targets.blockPosition
			try {
				equipTargets.item = pickBestToolItemForBlock(bot, targets.blockName)
				const chosen = equipTargets.item ? equipTargets.item.name : 'none'
				console.log('BehaviorCollectBlock: go to block -> equip best tool', chosen)
			} catch (_) {
				console.log('BehaviorCollectBlock: go to block -> equip best tool')
			}
        }
    })

	const equipToMineBlock = new StateTransition({
		parent: equipBestTool,
		child: mineBlock,
		name: 'BehaviorCollectBlock: equip best tool -> mine block',
		shouldTransition: () => true,
		onTransition: () => {
			console.log('BehaviorCollectBlock: equip best tool -> mine block')
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
                const posStr = pos ? `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})` : 'n/a'
                console.log(`BehaviorCollectBlock: find drop -> go to drop at ${posStr} dist ${dist}`)
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
		goToBlockToEquip,
		equipToMineBlock,
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


