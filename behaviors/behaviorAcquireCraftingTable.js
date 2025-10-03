const {
    BehaviorIdle,
    StateTransition,
    NestedStateMachine,
} = require('mineflayer-statemachine')

const createCollectBlockIfNeededState = require('./behaviorCollectBlockIfNeeded')
const createCraftNoTableIfNeededState = require('./behaviorCraftNoTableIfNeeded')

const { getItemCountInInventory } = require('../util')
const logger = require('../utils/logger')

function createAcquireCraftingTableState(bot, targets) {
    if (targets == null) {
        targets = {}
    }

    targets.blockName = 'oak_log'
    targets.amount = 1
    targets.itemName = 'oak_log'

    const enter = new BehaviorIdle()

    const collectLogsIfNeededState = createCollectBlockIfNeededState(bot, targets)

    const craftPlanksIfNeededState = createCraftNoTableIfNeededState(bot, targets)

    const craftCraftingTableIfNeededState = createCraftNoTableIfNeededState(bot, targets)

    const exit = new BehaviorIdle()

    const enterToExit = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: enter -> exit',
        parent: enter,
        child: exit,
        shouldTransition: () => getItemCountInInventory(bot, 'crafting_table') >= 1,
        onTransition: () => {
            targets.item = bot.inventory.items().find(item => item.name === 'crafting_table');
            logger.info('BehaviorAcquireCraftingTable: enter -> exit: Crafting table in inventory')
        }
    })

    const enterToCraftCraftingTable = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: enter -> craft crafting table',
        parent: enter,
        child: craftCraftingTableIfNeededState,
        shouldTransition: () => getItemCountInInventory(bot, 'oak_planks') >= 4,
        onTransition: () => {
            targets.itemName = 'crafting_table'
            targets.amount = 1
            logger.info('BehaviorAcquireCraftingTable: enter -> craft crafting table: Already have enough planks')
        }
    })

    const enterToCraftPlanks = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: enter -> craft planks',
        parent: enter,
        child: craftPlanksIfNeededState,
        shouldTransition: () => getItemCountInInventory(bot, 'oak_log') >= 1,
        onTransition: () => {
            targets.itemName = 'oak_planks'
            targets.amount = 4
            logger.info('BehaviorAcquireCraftingTable: enter -> craft planks: Already have a log')
        }
    })

    const enterToCollectLogs = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: enter -> collect logs',
        parent: enter,
        child: collectLogsIfNeededState,
        shouldTransition: () => getItemCountInInventory(bot, 'oak_log') < 1,
        onTransition: () => {
            targets.itemName = 'oak_log'
            targets.amount = 1
            logger.info('BehaviorAcquireCraftingTable: enter -> collect logs: Need a log')
        }
    })

    const collectLogsToExit = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: collect logs -> exit',
        parent: collectLogsIfNeededState,
        child: exit,
        shouldTransition: () => collectLogsIfNeededState.isFinished() && getItemCountInInventory(bot, 'oak_log') < 1,
        onTransition: () => {
            logger.info('BehaviorAcquireCraftingTable: collect logs -> exit: Could not collect any logs')
        }
    })

    const collectLogsToCraftPlanks = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: collect logs -> craft planks',
        parent: collectLogsIfNeededState,
        child: craftPlanksIfNeededState,
        shouldTransition: () => collectLogsIfNeededState.isFinished() && getItemCountInInventory(bot, 'oak_log') >= 1,
        onTransition: () => {
            targets.itemName = 'oak_planks'
            targets.amount = 4
            logger.info('BehaviorAcquireCraftingTable: collect logs -> craft planks: Collected logs')
        }
    })

    const craftPlanksToExit = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: craft planks -> exit',
        parent: craftPlanksIfNeededState,
        child: exit,
        shouldTransition: () => craftPlanksIfNeededState.isFinished() && getItemCountInInventory(bot, 'oak_planks') < 4,
        onTransition: () => {
            logger.info('BehaviorAcquireCraftingTable: craft planks -> exit: Could not craft planks')
        }
    })

    const craftPlanksToCraftCraftingTable = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: craft planks -> craft crafting table',
        parent: craftPlanksIfNeededState,
        child: craftCraftingTableIfNeededState,
        shouldTransition: () => craftPlanksIfNeededState.isFinished() && getItemCountInInventory(bot, 'oak_planks') >= 4,
        onTransition: () => {
            targets.itemName = 'crafting_table'
            targets.amount = 1
            logger.info('BehaviorAcquireCraftingTable: craft planks -> craft crafting table: Crafted planks')
        }
    })

    const craftCraftingTableToExit = new StateTransition({
        name: 'BehaviorAcquireCraftingTable: craft crafting table -> exit',
        parent: craftCraftingTableIfNeededState,
        child: exit,
        shouldTransition: () => craftCraftingTableIfNeededState.isFinished(),
        onTransition: () => {
            targets.item = bot.inventory.items().find(item => item.name === 'crafting_table');
            logger.info('BehaviorAcquireCraftingTable: craft crafting table -> exit: Crafted crafting table')
        }
    })

    const transitions = [
        enterToExit,
        enterToCraftCraftingTable,
        enterToCraftPlanks,
        enterToCollectLogs,
        collectLogsToExit,
        collectLogsToCraftPlanks,
        craftPlanksToExit,
        craftPlanksToCraftCraftingTable,
        craftCraftingTableToExit
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createAcquireCraftingTableState


