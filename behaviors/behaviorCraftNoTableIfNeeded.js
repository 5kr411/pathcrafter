const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')

const behaviorCraftNoTable = require('./behaviorCraftNoTable')

const { getItemCountInInventory } = require('../util')
const logger = require('../utils/logger')

function createCraftNoTableIfNeededState(bot, targets) {
    const enter = new BehaviorIdle()
    const craftNoTable = new behaviorCraftNoTable(bot, targets)
    const exit = new BehaviorIdle()

    const enterToExit = new StateTransition({
        name: 'BehaviorCraftNoTableIfNeeded: enter -> exit',
        parent: enter,
        child: exit,
        shouldTransition: () => {
            return getItemCountInInventory(bot, targets.itemName) >= targets.amount
        },
        onTransition: () => {
            logger.info(`BehaviorCraftNoTableIfNeeded: enter -> exit: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`)
        }
    })

    const enterToCraftNoTable = new StateTransition({
        name: 'BehaviorCraftNoTableIfNeeded: enter -> craft no table',
        parent: enter,
        child: craftNoTable,
        shouldTransition: () => {
            return getItemCountInInventory(bot, targets.itemName) < targets.amount
        },
        onTransition: () => {
            targets.amount = targets.amount - getItemCountInInventory(bot, targets.itemName)
            logger.info(`BehaviorCraftNoTableIfNeeded: enter -> craft no table: ${getItemCountInInventory(bot, targets.itemName)}/${targets.amount} ${targets.itemName} in inventory`)
        }
    })

    const craftNoTableToExit = new StateTransition({
        name: 'BehaviorCraftNoTableIfNeeded: craft no table -> exit',
        parent: craftNoTable,
        child: exit,
        shouldTransition: () => craftNoTable.isFinished(),
        onTransition: () => {
            logger.info('BehaviorCraftNoTableIfNeeded: craft no table -> exit')
        }
    })

    const transitions = [
        enterToExit,
        enterToCraftNoTable,
        craftNoTableToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createCraftNoTableIfNeededState


