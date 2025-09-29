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
                if (broken) return true
            } catch (_) {}
            return Date.now() - mineFinishTime > 750;
        },
        onTransition: () => {
            const moveDuration = moveStartTime ? (Date.now() - moveStartTime) : 0
            console.log(`BehaviorBreakAtPosition: mine -> exit (move took ${moveDuration}ms)`)            
        }
    })

    const transitions = [enterToExit, enterToFind, findToMove, moveToMine, mineToExit]
    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createBreakAtPositionState



