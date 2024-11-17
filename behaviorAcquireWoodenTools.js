const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
} = require('mineflayer-statemachine')

const { getItemCountInInventory } = require('./util')

const createAcquireCraftingTableState = require('./behaviorAcquireCraftingTable')

const createCollectBlockIfNeededState = require('./behaviorCollectBlockIfNeeded')

const createPlaceUtilityBlockState = require('./behaviorPlaceNear')

const createCraftWoodenToolsIfNeededState = require('./behaviorCraftWoodenToolsIfNeeded')

function createAcquireWoodenToolsState(bot, targets) {
    const enter = new BehaviorIdle()

    const acquireCraftingTableState = createAcquireCraftingTableState(bot, targets)

    const collectLogsIfNeededState = createCollectBlockIfNeededState(bot, targets)

    const placeCraftingTableState = createPlaceUtilityBlockState(bot, targets)

    const craftWoodenToolsIfNeededState = createCraftWoodenToolsIfNeededState(bot, targets)

    const exit = new BehaviorIdle()

    const enterToExit = new StateTransition({
        name: 'BehaviorAcquireWoodenTools: enter -> exit',
        parent: enter,
        child: exit,
        shouldTransition: () => getItemCountInInventory(bot, 'wooden_pickaxe') >= 1 && getItemCountInInventory(bot, 'wooden_axe') >= 1,
        onTransition: () => {
            console.log('BehaviorAcquireWoodenTools: enter -> exit: Wooden tools in inventory')
        }
    })

    const enterToAcquireCraftingTable = new StateTransition({
        parent: enter,
        child: acquireCraftingTableState,
        name: 'BehaviorAcquireWoodenTools: enter -> acquire crafting table',
        shouldTransition: () => true,
        onTransition: () => {
            console.log('BehaviorAcquireWoodenTools: enter -> acquire crafting table')
        }
    })

    function hasWoodenTool(bot) {
        return getItemCountInInventory(bot, 'wooden_pickaxe') >= 1 || getItemCountInInventory(bot, 'wooden_axe') >= 1
    }

    function needToCollectLogs(bot) {
        if (getItemCountInInventory(bot, 'oak_log') >= 2) {
            console.log('BehaviorAcquireWoodenTools: do not need to collect logs: already have 2 logs')
            return false
        }

        if (getItemCountInInventory(bot, 'oak_planks') >= 8) {
            console.log('BehaviorAcquireWoodenTools: do not need to collect logs: already have 8 planks')
            return false
        }

        if (getItemCountInInventory(bot, 'oak_log') >= 1 && getItemCountInInventory(bot, 'oak_planks') >= 4) {
            console.log('BehaviorAcquireWoodenTools: do not need to collect logs: already have 1 log and 4 planks')
            return false
        }

        if (getItemCountInInventory(bot, 'oak_planks') >= 6 && getItemCountInInventory(bot, 'stick') >= 4) {
            console.log('BehaviorAcquireWoodenTools: do not need to collect logs: already have 6 planks and 4 sticks')
            return false
        }

        if (hasWoodenTool(bot) && getItemCountInInventory(bot, 'oak_planks') >= 5) {
            console.log('BehaviorAcquireWoodenTools: do not need to collect logs: already have a wooden tool and 5 planks')
            return false
        }

        if (hasWoodenTool(bot) && getItemCountInInventory(bot, 'oak_planks') >= 3 && getItemCountInInventory(bot, 'stick') >= 2) {
            console.log('BehaviorAcquireWoodenTools: do not need to collect logs: already have a wooden tool and 3 planks and 2 sticks')
            return false
        }

        console.log('BehaviorAcquireWoodenTools: need to collect logs')
        return true
    }

    const acquireCraftingTableToCollectLogs = new StateTransition({
        parent: acquireCraftingTableState,
        child: collectLogsIfNeededState,
        name: 'BehaviorAcquireWoodenTools: acquire crafting table -> collect logs',
        shouldTransition: () => acquireCraftingTableState.isFinished() && needToCollectLogs(bot),
        onTransition: () => {
            console.log('BehaviorAcquireWoodenTools: acquire crafting table -> collect logs')
            targets.blockName = 'oak_log'
            targets.amount = 2
            targets.itemName = 'oak_log'
        }
    })

    let placeCraftingTableStartTime
    const acquireCraftingTableToPlaceCraftingTable = new StateTransition({
        parent: acquireCraftingTableState,
        child: placeCraftingTableState,
        name: 'BehaviorAcquireWoodenTools: acquire crafting table -> place crafting table',
        shouldTransition: () => acquireCraftingTableState.isFinished() && !needToCollectLogs(bot),
        onTransition: () => {
            placeCraftingTableStartTime = Date.now()
            console.log('BehaviorAcquireWoodenTools: acquire crafting table -> place crafting table')
        }
    })

    const collectLogsToPlaceCraftingTable = new StateTransition({
        parent: collectLogsIfNeededState,
        child: placeCraftingTableState,
        name: 'BehaviorAcquireWoodenTools: collect logs -> place crafting table',
        shouldTransition: () => collectLogsIfNeededState.isFinished(),
        onTransition: () => {
            placeCraftingTableStartTime = Date.now()
            console.log('BehaviorAcquireWoodenTools: collect logs -> place crafting table')
        }
    })

    const placeCraftingTableToCraftWoodenTools = new StateTransition({
        parent: placeCraftingTableState,
        child: craftWoodenToolsIfNeededState,
        name: 'BehaviorAcquireWoodenTools: place crafting table -> craft wooden tools',
        shouldTransition: () => placeCraftingTableState.isFinished() && Date.now() - placeCraftingTableStartTime > 2000,
        onTransition: () => {
            console.log('BehaviorAcquireWoodenTools: place crafting table -> craft wooden tools')
        }
    })

    const craftWoodenToolsToExit = new StateTransition({
        parent: craftWoodenToolsIfNeededState,
        child: exit,
        name: 'BehaviorAcquireWoodenTools: craft wooden tools -> exit',
        shouldTransition: () => craftWoodenToolsIfNeededState.isFinished(),
        onTransition: () => {
            console.log('BehaviorAcquireWoodenTools: craft wooden tools -> exit')
        }
    })

    const transitions = [
        enterToExit,
        enterToAcquireCraftingTable,
        acquireCraftingTableToCollectLogs,
        acquireCraftingTableToPlaceCraftingTable,
        collectLogsToPlaceCraftingTable,
        placeCraftingTableToCraftWoodenTools,
        craftWoodenToolsToExit,
    ]

    return new NestedStateMachine(transitions, enter, exit)
}

module.exports = createAcquireWoodenToolsState
