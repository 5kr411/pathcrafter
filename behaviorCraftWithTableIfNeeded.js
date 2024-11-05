const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
} = require('mineflayer-statemachine')

const createCraftWithTable = require('./behaviorCraftWithTable')

const { getItemCountInInventory } = require('./util')

function createCraftWithTableIfNeeded(bot, targets) {
    const enter = new BehaviorIdle()

    const craftWithTableState = createCraftWithTable(bot, targets)

    const exit = new BehaviorIdle()

    const enterToExit = new StateTransition({
        name: 'BehaviorCraftWithTableIfNeeded: enter -> exit',
        parent: enter,
        child: exit,
        shouldTransition: () => {
            return getItemCountInInventory(bot, targets.itemName) >= targets.amount
        },
        onTransition: () => {
            console.log(`BehaviorCraftWithTableIfNeeded: enter -> exit: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`)
        }
    })

    const enterToCraftWithTable = new StateTransition({
        parent: enter,
        child: craftWithTableState,
        name: 'BehaviorCraftWithTableIfNeeded: enter -> craft with table',
        shouldTransition: () => {
            return getItemCountInInventory(bot, targets.itemName) < targets.amount
        },
        onTransition: () => {
            targets.amount = targets.amount - getItemCountInInventory(bot, targets.itemName)
            console.log(`BehaviorCraftWithTableIfNeeded: enter -> craft with table: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`)
        }
    })

    const craftWithTableToExit = new StateTransition({
        parent: craftWithTableState,
        child: exit,
        name: 'BehaviorCraftWithTableIfNeeded: craft with table -> exit',
        shouldTransition: () => craftWithTableState.isFinished(),
        onTransition: () => {
            console.log('BehaviorCraftWithTableIfNeeded: craft with table -> exit')
        }
    })

    const transitions = [
        enterToExit,
        enterToCraftWithTable,
        craftWithTableToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCraftWithTableIfNeeded
