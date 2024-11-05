const mineflayer = require('mineflayer')

const { workerData, parentPort, isMainThread } = require('worker_threads')

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BotStateMachine,
} = require('mineflayer-statemachine')

const createAcquireCraftingTableState = require('./behaviorAcquireCraftingTable')

const createPlaceUtilityBlockState = require('./behaviorPlaceNear')

const createCraftWithTableState = require('./behaviorCraftWithTable')

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

        let targets = {}

        const enter = new BehaviorIdle()

        const acquireCraftingTableState = createAcquireCraftingTableState(bot, targets)

        const placeCraftingTableState = createPlaceUtilityBlockState(bot, targets)

        const craftPlanksState = createCraftWithTableState(bot, targets)

        const craftSticksState = createCraftWithTableState(bot, targets)

        const craftWoodenPickaxeState = createCraftWithTableState(bot, targets)

        const craftWoodenAxeState = createCraftWithTableState(bot, targets)

        const exit = new BehaviorIdle()

        const enterToAcquireCraftingTable = new StateTransition({
            name: 'worker: enter -> acquire crafting table',
            parent: enter,
            child: acquireCraftingTableState,
            shouldTransition: () => true,
            onTransition: () => {
                console.log('worker: enter -> acquire crafting table')
            }
        })

        let placeCraftingTableStartTime
        const acquireCraftingTableToPlaceCraftingTable = new StateTransition({
            name: 'worker: acquire crafting table -> place crafting table',
            parent: acquireCraftingTableState,
            child: placeCraftingTableState,
            shouldTransition: () => acquireCraftingTableState.isFinished(),
            onTransition: () => {
                placeCraftingTableStartTime = Date.now()
                console.log('worker: acquire crafting table -> place crafting table')
            }
        })

        const placeCraftingTableToCraftPlanks = new StateTransition({
            name: 'worker: place crafting table -> craft planks',
            parent: placeCraftingTableState,
            child: craftPlanksState,
            shouldTransition: () => placeCraftingTableState.isFinished() && Date.now() - placeCraftingTableStartTime > 2000,
            onTransition: () => {
                targets.itemName = 'oak_planks'
                targets.amount = 8
                console.log('worker: place crafting table -> craft planks')
            }
        })

        const craftPlanksToCraftSticks = new StateTransition({
            name: 'worker: craft planks -> craft sticks',
            parent: craftPlanksState,
            child: craftSticksState,
            shouldTransition: () => craftPlanksState.isFinished(),
            onTransition: () => {
                targets.itemName = 'stick'
                targets.amount = 4
                console.log('worker: craft planks -> craft sticks')
            }
        })


        const craftSticksToCraftWoodenPickaxe = new StateTransition({
            name: 'worker: craft sticks -> craft wooden pickaxe',
            parent: craftSticksState,
            child: craftWoodenPickaxeState,
            shouldTransition: () => craftSticksState.isFinished(),
            onTransition: () => {
                targets.itemName = 'wooden_pickaxe'
                targets.amount = 1
                console.log('worker: craft sticks -> craft wooden pickaxe')
            }
        })

        const craftWoodenPickaxeToCraftWoodenAxe = new StateTransition({
            name: 'worker: craft wooden pickaxe -> craft wooden axe',
            parent: craftWoodenPickaxeState,
            child: craftWoodenAxeState,
            shouldTransition: () => craftWoodenPickaxeState.isFinished(),
            onTransition: () => {
                targets.itemName = 'wooden_axe'
                targets.amount = 1
                console.log('worker: craft wooden pickaxe -> craft wooden axe')
            }
        })

        const craftWoodenAxeToExit = new StateTransition({
            name: 'worker: craft wooden axe -> exit',
            parent: craftWoodenAxeState,
            child: exit,
            shouldTransition: () => craftWoodenAxeState.isFinished(),
            onTransition: () => {
                console.log('worker: craft wooden axe -> exit')
            }
        })

        const exitToEnter = new StateTransition({
            name: 'worker: exit -> enter',
            parent: exit,
            child: enter,
            shouldTransition: () => false,
            onTransition: () => {
                console.log('worker: exit -> enter')
            }
        })

        const transitions = [
            enterToAcquireCraftingTable,
            acquireCraftingTableToPlaceCraftingTable,
            placeCraftingTableToCraftPlanks,
            craftPlanksToCraftSticks,
            craftSticksToCraftWoodenPickaxe,
            craftWoodenPickaxeToCraftWoodenAxe,
            craftWoodenAxeToExit,
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
