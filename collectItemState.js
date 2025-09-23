const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
} = require('mineflayer-statemachine')

const plan = require('./planner')

function createAcquireItemState(bot, targets) {
    const enter = new BehaviorIdle()
    const evaluate = new BehaviorIdle()
    const exit = new BehaviorIdle()

    const enterToExit = new StateTransition({
        parent: enter,
        child: exit,
        name: 'acquireItemState: enter -> exit',
        shouldTransition: () => targets.itemName === undefined,
        onTransition: () => {
            console.log('acquireItemState: enter -> exit, no item name')
        }
    })

    const enterToEvaluate = new StateTransition({
        parent: enter,
        child: evaluate,
        name: 'acquireItemState: enter -> evaluate',
        shouldTransition: () => true,
        onTransition: () => {
            console.log('acquireItemState: enter -> evaluate:', targets.itemName, targets.amount)
            plan(bot, targets.itemName, targets.amount)
        }
    })

    const evaluateToExit = new StateTransition({
        parent: evaluate,
        child: exit,
        name: 'acquireItemState: evaluate -> exit',
        shouldTransition: () => true,
        onTransition: () => {
            console.log('acquireItemState: evaluate -> exit')
        }
    })

    const transitions = [
        enterToExit,
        enterToEvaluate,
        evaluateToExit,
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createAcquireItemState
