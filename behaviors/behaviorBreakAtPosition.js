const Vec3 = require('vec3').Vec3;

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BehaviorFindInteractPosition,
    BehaviorMoveTo,
    BehaviorMineBlock
} = require('mineflayer-statemachine')
const logger = require('../utils/logger')
const { addStateLogging } = require('../utils/stateLogging')

function createBreakAtPositionState(bot, targets) {
    const enter = new BehaviorIdle()
    const findInteract = new BehaviorFindInteractPosition(bot, targets)
    
    // Add logging to FindInteractPosition
    addStateLogging(findInteract, 'FindInteractPosition', {
        logEnter: true,
        getExtraInfo: () => {
            const pos = targets.blockPosition
            return pos ? `for block at (${pos.x}, ${pos.y}, ${pos.z})` : ''
        }
    })
    
    const moveTo = new BehaviorMoveTo(bot, targets)
    
    // Add logging to MoveTo
    addStateLogging(moveTo, 'MoveTo', {
        logEnter: true,
        getExtraInfo: () => {
            const pos = targets.position
            if (!pos) return 'no position'
            const dist = bot.entity.position.distanceTo(pos).toFixed(2)
            return `to break position (${pos.x}, ${pos.y}, ${pos.z}), distance: ${dist}m`
        }
    })
    
    const mine = new BehaviorMineBlock(bot, targets)
    
    // Add detailed logging to MineBlock with timing
    let loggingMineStartTime = null
    const originalMineOnStateEntered = typeof mine.onStateEntered === 'function' 
        ? mine.onStateEntered.bind(mine) 
        : null
    mine.onStateEntered = function() {
        loggingMineStartTime = Date.now()
        const pos = targets.blockPosition || targets.position
        try {
            const block = pos ? bot.blockAt(pos) : null
            const blockName = block?.name || 'unknown'
            logger.debug(`MineBlock: breaking ${blockName} at (${pos?.x}, ${pos?.y}, ${pos?.z})`)
        } catch (_) {
            logger.debug(`MineBlock: breaking block at position`)
        }
        if (originalMineOnStateEntered) return originalMineOnStateEntered()
    }
    
    const originalMineOnStateExited = typeof mine.onStateExited === 'function'
        ? mine.onStateExited.bind(mine)
        : null
    mine.onStateExited = function() {
        if (loggingMineStartTime) {
            const duration = Date.now() - loggingMineStartTime
            logger.debug(`MineBlock: finished breaking (took ${duration}ms)`)
        }
        if (originalMineOnStateExited) return originalMineOnStateExited()
    }
    
    const exit = new BehaviorIdle()

    // Track per-target dig completion by listening for block updates to air
    function waitForBlockToBecomeAir(pos, timeoutMs = 8000) {
        try {
            if (!pos) return Promise.resolve(false)
            const currentType = bot.world.getBlockType(pos)
            if (currentType === 0) return Promise.resolve(true)
        } catch (_) { /* ignore */ }
        return new Promise(resolve => {
            const eventName = `blockUpdate:(${pos.x}, ${pos.y}, ${pos.z})`
            let done = false
            const onUpdate = (oldBlock, newBlock) => {
                if (done) return
                if (!newBlock || newBlock.type === 0) {
                    done = true
                    cleanup()
                    resolve(true)
                }
            }
            const onTimeout = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false) } }, timeoutMs)
            const cleanup = () => {
                try { bot.world.removeListener(eventName, onUpdate) } catch (_) {}
                clearTimeout(onTimeout)
            }
            try { bot.world.on(eventName, onUpdate) } catch (_) { done = true; clearTimeout(onTimeout); resolve(false) }
        })
    }

    const enterToExit = new StateTransition({
        name: 'BehaviorBreakAtPosition: enter -> exit',
        parent: enter,
        child: exit,
        shouldTransition: () => targets.position == null,
        onTransition: () => {
            logger.info('BehaviorBreakAtPosition: enter -> exit: position is null')
        }
    })

    const enterToFind = new StateTransition({
        name: 'BehaviorBreakAtPosition: enter -> find',
        parent: enter,
        child: findInteract,
        shouldTransition: () => targets.position != null,
        onTransition: () => {
            logger.info('BehaviorBreakAtPosition: enter -> find')
            targets.blockPosition = targets.position;
        }
    })

    const findToMove = new StateTransition({
        name: 'BehaviorBreakAtPosition: find -> move',
        parent: findInteract,
        child: moveTo,
        shouldTransition: () => true,
        onTransition: () => {
            logger.info('BehaviorBreakAtPosition: find -> move')
        }
    })

    const MOVE_TIMEOUT_MS = 15000
    const MINE_TIMEOUT_MS = 12000

    let moveStartTime
    let brokenObserved = false
    let digRetries = 0
    const moveToMine = new StateTransition({
        name: 'BehaviorBreakAtPosition: move -> mine',
        parent: moveTo,
        child: mine,
        shouldTransition: () => {
            if (!moveTo.isFinished() || moveTo.distanceToTarget() >= 6) return false
            try {
                const blk = bot.blockAt(targets.blockPosition, false)
                if (!blk) return false
                if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(blk)) return false
            } catch (_) { return false }
            return true
        },
        onTransition: () => {
            moveStartTime = moveStartTime || Date.now()
            logger.info('BehaviorBreakAtPosition: move -> mine')
            targets.position = targets.blockPosition;
            brokenObserved = false
            // Start waiting for this block to become air while mining is active
            const pos = targets.blockPosition && targets.blockPosition.clone ? targets.blockPosition.clone() : targets.blockPosition
            waitForBlockToBecomeAir(pos, 10000).then(ok => { if (ok) brokenObserved = true })
        }
    })

    // If we can't reach the block or moving takes too long, exit gracefully
    const moveToExit = new StateTransition({
        name: 'BehaviorBreakAtPosition: move -> exit (timeout/unreachable)',
        parent: moveTo,
        child: exit,
        shouldTransition: () => {
            const started = moveStartTime != null
            const tookTooLong = started && (Date.now() - moveStartTime > MOVE_TIMEOUT_MS)
            const stuckFar = moveTo.isFinished() && moveTo.distanceToTarget() >= 6
            return tookTooLong || stuckFar
        },
        onTransition: () => {
            const elapsed = moveStartTime ? (Date.now() - moveStartTime) : 0
            logger.info(`BehaviorBreakAtPosition: move -> exit (elapsed=${elapsed}ms, dist=${moveTo.distanceToTarget && moveTo.distanceToTarget()})`)
        }
    })

    let mineFinishTime
    let mineStartTime
    const mineToExit = new StateTransition({
        name: 'BehaviorBreakAtPosition: mine -> exit',
        parent: mine,
        child: exit,
        shouldTransition: () => {
            if (mine.isFinished && !mineFinishTime) mineFinishTime = Date.now();
            try {
                const broken = targets.blockPosition && bot.world.getBlockType(targets.blockPosition) === 0
                if (broken || brokenObserved) return true
            } catch (_) {}
            // Exit if mining is taking too long or the target is invalid
            const timedOut = mineStartTime != null && (Date.now() - mineStartTime > MINE_TIMEOUT_MS)
            let invalidTarget = false
            try {
                const blk = targets.blockPosition && bot.blockAt(targets.blockPosition, false)
                invalidTarget = !blk || (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(blk))
            } catch (_) { invalidTarget = true }
            return timedOut || invalidTarget;
        },
        onTransition: () => {
            const moveDuration = moveStartTime ? (Date.now() - moveStartTime) : 0
            const mineDuration = mineStartTime ? (Date.now() - mineStartTime) : 0
            logger.info(`BehaviorBreakAtPosition: mine -> exit (move took ${moveDuration}ms, mine took ${mineDuration}ms)`)            
        }
    })

    // If mining finished but block still not broken, retry find->move->mine cycle
    const mineToRetry = new StateTransition({
        name: 'BehaviorBreakAtPosition: mine -> retry',
        parent: mine,
        child: findInteract,
        shouldTransition: () => {
            try {
                const stillThere = targets.blockPosition && bot.world.getBlockType(targets.blockPosition) !== 0
                return mine.isFinished && !brokenObserved && stillThere && digRetries < 4
            } catch (_) { return mine.isFinished && !brokenObserved && digRetries < 4 }
        },
        onTransition: () => {
            digRetries++
            logger.info(`BehaviorBreakAtPosition: mine -> retry (${digRetries})`)
        }
    })

    // Capture when we enter moving to start timeout tracking
    findToMove.onTransition = () => {
        logger.info('BehaviorBreakAtPosition: find -> move')
        moveStartTime = Date.now()
    }

    // Capture mining start to enable timeout
    const originalMoveToMineOnTransition = moveToMine.onTransition
    moveToMine.onTransition = () => {
        mineStartTime = Date.now()
        originalMoveToMineOnTransition()
    }

    const transitions = [enterToExit, enterToFind, findToMove, moveToMine, moveToExit, mineToExit, mineToRetry]
    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createBreakAtPositionState



