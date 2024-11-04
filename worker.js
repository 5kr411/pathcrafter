const mineflayer = require('mineflayer')

const { workerData, parentPort, isMainThread } = require('worker_threads')

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BotStateMachine,
} = require('mineflayer-statemachine')

const createCollectBlockIfNeededState = require('./behaviorCollectBlockIfNeeded')

const createCraftNoTableIfNeededState = require('./behaviorCraftNoTableIfNeeded')

const createPlaceUtilityBlockState = require('./behaviorPlaceNear')

let botOptions = {
    host: 'localhost',
    port: 25565,
    username: 'Bot',
}

if (isMainThread) {
    if (process.argv.length < 4 || process.argv.length > 6) {
        console.log('Usage : node worker.js <host> <port> [<name>] [<password>]');
        process.exit(1);
    }

    botOptions.host = process.argv[2];
    botOptions.port = parseInt(process.argv[3]);
    if (process.argv[4]) botOptions.username = process.argv[4];
    if (process.argv[5]) botOptions.password = process.argv[5];
} else if (workerData) {
    Object.assign(botOptions, {
        host: workerData.host,
        port: workerData.port,
        username: workerData.username,
        password: workerData.password,
    });
}

const bot = mineflayer.createBot(botOptions)

bot.loadPlugin(require('mineflayer-pathfinder').pathfinder)

async function main() {
    bot.once('spawn', () => {
        if (!isMainThread && parentPort) {
            parentPort.on('message', (message) => {
                // console.log('received message: ', message)
                // Handle worker-specific message logic
            })
        }

        let targets = {
            blockName: 'oak_log',
            numNeeded: 1,
            itemName: 'oak_log'
        }

        const enter = new BehaviorIdle()

        const collectLogsIfNeededState = createCollectBlockIfNeededState(bot, targets)

        const craftPlanksIfNeededState = createCraftNoTableIfNeededState(bot, targets)

        const craftCraftingTableIfNeededState = createCraftNoTableIfNeededState(bot, targets)

        const placeCraftingTableState = createPlaceUtilityBlockState(bot, targets)

        const exit = new BehaviorIdle()

        const enterToCollectBlock = new StateTransition({
            name: 'main: enter -> collect block',
            parent: enter,
            child: collectLogsIfNeededState,
            shouldTransition: () => true,
            onTransition: () => {
                console.log('main: enter -> collect block')
            }
        })

        const collectLogsToCraftPlanks = new StateTransition({
            name: 'main: collect logs -> craft planks',
            parent: collectLogsIfNeededState,
            child: craftPlanksIfNeededState,
            shouldTransition: () => collectLogsIfNeededState.isFinished(),
            onTransition: () => {
                console.log('main: collect logs -> craft planks')
                targets.itemName = 'oak_planks'
                targets.numNeeded = 4
            }
        })

        const craftPlanksToCraftCraftingTable = new StateTransition({
            name: 'main: craft planks -> craft crafting table',
            parent: craftPlanksIfNeededState,
            child: craftCraftingTableIfNeededState,
            shouldTransition: () => craftPlanksIfNeededState.isFinished(),
            onTransition: () => {
                console.log('main: craft planks -> craft crafting table')
                targets.itemName = 'crafting_table'
                targets.numNeeded = 1
            }
        })

        const craftCraftingTableToPlaceCraftingTable = new StateTransition({
            name: 'main: craft crafting table -> place crafting table',
            parent: craftCraftingTableIfNeededState,
            child: placeCraftingTableState,
            shouldTransition: () => craftCraftingTableIfNeededState.isFinished(),
            onTransition: () => {
                console.log('main: craft crafting table -> place crafting table')
                targets.item = bot.inventory.items().find(item => item.name === 'crafting_table');
            }
        })

        const placeCraftingTableToExit = new StateTransition({
            name: 'main: place crafting table -> exit',
            parent: placeCraftingTableState,
            child: exit,
            shouldTransition: () => placeCraftingTableState.isFinished(),
            onTransition: () => {
                console.log('main: place crafting table -> exit')
            }
        })

        const exitToEnter = new StateTransition({
            name: 'main: exit -> enter',
            parent: exit,
            child: enter,
            shouldTransition: () => false,
            onTransition: () => {
                console.log('main: exit -> enter')
            }
        })

        const transitions = [
            enterToCollectBlock,
            collectLogsToCraftPlanks,
            craftPlanksToCraftCraftingTable,
            craftCraftingTableToPlaceCraftingTable,
            placeCraftingTableToExit,
            exitToEnter
        ]

        const root = new NestedStateMachine(transitions, enter)
        root.name = 'main'

        const stateMachine = new BotStateMachine(bot, root)

        bot.on('chat', (username, message) => {
            if (username === bot.username) return
            if (message === 'go') {
                exitToEnter.trigger()
            }
        })
    })
}

main()
