const Vec3 = require('vec3').Vec3;

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BehaviorFindInteractPosition,
    BehaviorMoveTo,
    BehaviorMineBlock
} = require('mineflayer-statemachine')

function createBreakAtPositionState(bot, targets) {
    const enter = new BehaviorIdle()
    const findInteract = new BehaviorFindInteractPosition(bot, targets)
    const moveTo = new BehaviorMoveTo(bot, targets)
    const mine = new BehaviorMineBlock(bot, targets)
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
            console.log('BehaviorBreakAtPosition: enter -> exit: position is null')
        }
    })

    const enterToFind = new StateTransition({
        name: 'BehaviorBreakAtPosition: enter -> find',
        parent: enter,
        child: findInteract,
        shouldTransition: () => targets.position != null,
        onTransition: () => {
            console.log('BehaviorBreakAtPosition: enter -> find')
            targets.blockPosition = targets.position;
        }
    })

    const findToMove = new StateTransition({
        name: 'BehaviorBreakAtPosition: find -> move',
        parent: findInteract,
        child: moveTo,
        shouldTransition: () => true,
        onTransition: () => {
            console.log('BehaviorBreakAtPosition: find -> move')
        }
    })

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
            moveStartTime = Date.now()
            console.log('BehaviorBreakAtPosition: move -> mine')
            targets.position = targets.blockPosition;
            brokenObserved = false
            // Start waiting for this block to become air while mining is active
            const pos = targets.blockPosition && targets.blockPosition.clone ? targets.blockPosition.clone() : targets.blockPosition
            waitForBlockToBecomeAir(pos, 10000).then(ok => { if (ok) brokenObserved = true })
        }
    })

    let mineFinishTime
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
            // Only allow exit if we've been mining for a long time and still no update
            return false;
        },
        onTransition: () => {
            const moveDuration = moveStartTime ? (Date.now() - moveStartTime) : 0
            console.log(`BehaviorBreakAtPosition: mine -> exit (move took ${moveDuration}ms)`)            
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
            console.log(`BehaviorBreakAtPosition: mine -> retry (${digRetries})`)
        }
    })

    const transitions = [enterToExit, enterToFind, findToMove, moveToMine, mineToExit, mineToRetry]
    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createBreakAtPositionState



