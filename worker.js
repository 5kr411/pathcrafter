const mineflayer = require('mineflayer')

const { workerData, parentPort, isMainThread } = require('worker_threads')

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BotStateMachine,
} = require('mineflayer-statemachine')

const createAcquireWoodenToolsState = require('./behaviorAcquireWoodenTools')

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

        const acquireWoodenToolsState = createAcquireWoodenToolsState(bot, targets)

        const exit = new BehaviorIdle()


        const enterToAcquireWoodenTools = new StateTransition({
            name: 'worker: enter -> acquire wooden tools',
            parent: enter,
            child: acquireWoodenToolsState,
            shouldTransition: () => true,
            onTransition: () => {
                console.log('worker: enter -> acquire wooden tools')
            }
        })

        const acquireWoodenToolsToExit = new StateTransition({
            name: 'worker: acquire wooden tools -> exit',
            parent: acquireWoodenToolsState,
            child: exit,
            shouldTransition: () => acquireWoodenToolsState.isFinished(),
            onTransition: () => {
                console.log('worker: acquire wooden tools -> exit')
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
            enterToAcquireWoodenTools,
            acquireWoodenToolsToExit,
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
