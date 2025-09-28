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

    const enterToFind = new StateTransition({
        name: 'BehaviorBreakAtPosition: enter -> find',
        parent: enter,
        child: findInteract,
        shouldTransition: () => targets.position != null,
        onTransition: () => {
            targets.blockPosition = targets.position;
        }
    })

    const findToMove = new StateTransition({
        name: 'BehaviorBreakAtPosition: find -> move',
        parent: findInteract,
        child: moveTo,
        shouldTransition: () => true
    })

    const moveToMine = new StateTransition({
        name: 'BehaviorBreakAtPosition: move -> mine',
        parent: moveTo,
        child: mine,
        shouldTransition: () => moveTo.isFinished() && moveTo.distanceToTarget() < 6,
        onTransition: () => {
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
            return Date.now() - mineFinishTime > 500;
        }
    })

    const transitions = [enterToFind, findToMove, moveToMine, mineToExit]
    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createBreakAtPositionState



