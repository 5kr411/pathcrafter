const mineflayer = require('mineflayer')

const { workerData, parentPort, isMainThread } = require('worker_threads')

const Vec3 = require('vec3').Vec3;

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BotStateMachine,
    BehaviorFindInteractPosition,
    BehaviorMoveTo,
    BehaviorPlaceBlock
} = require('mineflayer-statemachine')

const createCollectBlockState = require('./behaviorCollectBlock')

const createCraftNoTableState = require('./behaviorCraftNoTable')

const { getItemCountInInventory } = require('./util')

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
                console.log('received message: ', message)
                // Handle worker-specific message logic
            })
        }

        const targets = {
            blockName: 'log',
            numBlocksToCollect: 1,
            itemName: 'log'
        }

        const enter = new BehaviorIdle()

        const collectBlockState = createCollectBlockState(bot, targets)

        const craftPlanksState = createCraftNoTableState(bot, targets)

        const craftCraftingTableState = createCraftNoTableState(bot, targets)

        const findPlaceCoords = new BehaviorFindInteractPosition(bot, targets)

        const moveToPlaceCoords = new BehaviorMoveTo(bot, targets)
        moveToPlaceCoords.distance = 0.05

        const placeCraftingTable = new BehaviorPlaceBlock(bot, targets)

        const exit = new BehaviorIdle()

        const enterToCollectBlock = new StateTransition({
            name: 'main: enter to collect block',
            parent: enter,
            child: collectBlockState,
            shouldTransition: () => true,
            onTransition: () => {
                console.log('main: enter to collect block')
            }
        })

        const collectBlockToCraftPlanks = new StateTransition({
            name: 'main: collect block to craft planks',
            parent: collectBlockState,
            child: craftPlanksState,
            shouldTransition: () => collectBlockState.isFinished(),
            onTransition: () => {
                console.log('main: collect block to craft planks')
                targets.itemNameToCraft = 'planks'
                targets.timesToCraft = 1
                targets.expectedQuantityAfterCraft = 4
            }
        })

        let placeRetries = 1
        const craftPlanksToCraftCraftingTable = new StateTransition({
            name: 'main: craft planks to craft crafting table',
            parent: craftPlanksState,
            child: craftCraftingTableState,
            shouldTransition: () => craftPlanksState.isFinished(),
            onTransition: () => {
                console.log('main: craft planks to craft crafting table')
                targets.itemNameToCraft = 'crafting_table'
                targets.timesToCraft = 1
                targets.expectedQuantityAfterCraft = 1
                placeRetries = 0
            }
        })

        const craftCraftingTableToFindPlaceCoords = new StateTransition({
            name: 'main: craft crafting table to find place coords',
            parent: craftCraftingTableState,
            child: findPlaceCoords,
            shouldTransition: () => craftCraftingTableState.isFinished(),
            onTransition: () => {
                console.log('main: craft crafting table to find place coords')
                targets.position = bot.entity.position
                targets.position.x = Math.floor(targets.position.x) + 0.5
                targets.position.y = Math.floor(targets.position.y) - 1
                targets.position.z = Math.floor(targets.position.z) + 0.5
                targets.placePosition = targets.position.clone();
                console.log('Set place position:', targets.placePosition)

                targets.position.x += Math.random() < 0.5 ? -1.5 : 1.5;
                targets.position.z += Math.random() < 0.5 ? -1.5 : 1.5;
                console.log('Set target position:', targets.position)
            }
        })

        const findPlaceCoordsToMoveToPlaceCoords = new StateTransition({
            name: 'main: find place coords to move to place coords',
            parent: findPlaceCoords,
            child: moveToPlaceCoords,
            shouldTransition: () => true,
            onTransition: () => {
                console.log('main: find place coords to move to place coords')
            }
        })

        let placeCraftingTableStartTime
        const moveToPlaceCoordsToPlaceCraftingTable = new StateTransition({
            name: 'main: move to place coords to place crafting table',
            parent: moveToPlaceCoords,
            child: placeCraftingTable,
            shouldTransition: () => moveToPlaceCoords.isFinished(),
            onTransition: () => {
                placeCraftingTableStartTime = Date.now()
                console.log('main: move to place coords to place crafting table')
                const craftingTableItem = bot.inventory.items().find(item => item.name === 'crafting_table');
                if (craftingTableItem) {
                    targets.item = craftingTableItem;
                    console.log('Set target item:', targets.item.name);
                } else {
                    console.log('Crafting table not found in inventory');
                }
                targets.position = targets.placePosition
                targets.blockFace = new Vec3(0, 1, 0)

                targets.placedPosition = targets.position.clone()
                targets.placedPosition.y += 1
            }
        })

        const placeCraftingTableToFindPlaceCoords = new StateTransition({
            name: 'main: place crafting table to find place coords',
            parent: placeCraftingTable,
            child: findPlaceCoords,
            shouldTransition: () => Date.now() - placeCraftingTableStartTime > 1000 && (bot.world.getBlockType(targets.placedPosition) === 0 && placeRetries < 5),
            onTransition: () => {
                console.log(`main: place crafting table to find place coords (retry ${placeRetries})`)
                placeRetries++
            }
        })

        const placeCraftingTableToExit = new StateTransition({
            name: 'main: place crafting table to exit',
            parent: placeCraftingTable,
            child: exit,
            shouldTransition: () => Date.now() - placeCraftingTableStartTime > 1000 && (bot.world.getBlockType(targets.placedPosition) != 0 || placeRetries >= 5),
            onTransition: () => {
                console.log('main: place crafting table to exit')
                console.log('Block at place position:', bot.world.getBlockType(targets.placedPosition))
            }
        })

        const transitions = [
            enterToCollectBlock,
            collectBlockToCraftPlanks,
            craftPlanksToCraftCraftingTable,
            craftCraftingTableToFindPlaceCoords,
            findPlaceCoordsToMoveToPlaceCoords,
            moveToPlaceCoordsToPlaceCraftingTable,
            placeCraftingTableToFindPlaceCoords,
            placeCraftingTableToExit
        ]

        const root = new NestedStateMachine(transitions, enter)
        root.name = 'main'

        const stateMachine = new BotStateMachine(bot, root)
    })
}

main()
