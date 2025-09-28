const mineflayer = require('mineflayer')

const { workerData, parentPort, isMainThread } = require('worker_threads')

const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine,
    BotStateMachine,
} = require('mineflayer-statemachine')

const createCollectItemState = require('./collectItemState')

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

        const collectItemState = createCollectItemState(bot, targets)

        const exit = new BehaviorIdle()


        const enterToCollectItem = new StateTransition({
            name: 'worker: enter -> collect item',
            parent: enter,
            child: collectItemState,
            shouldTransition: () => true,
            onTransition: () => {
                console.log('worker: enter -> collect item')
                if (!targets.itemName) {
                    targets.itemName = 'gold_ingot'
                }
                if (!targets.amount) {
                    targets.amount = 1
                }
            }
        })

        const collectItemToExit = new StateTransition({
            name: 'worker: collect item -> exit',
            parent: collectItemState,
            child: exit,
            shouldTransition: () => collectItemState.isFinished(),
            onTransition: () => {
                console.log('worker: collect item -> exit')
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
            enterToCollectItem,
            collectItemToExit,
            exitToEnter
        ]

        const root = new NestedStateMachine(transitions, enter)
        root.name = 'main'

        const stateMachine = new BotStateMachine(bot, root)

        bot.on('chat', (username, message) => {
            if (username === bot.username) return

            const parts = message.split(' ')

            if (parts[0] === 'go') {
                exitToEnter.trigger()
            }

            if (parts[0] === 'collect') {
                exitToEnter.trigger()
                targets.itemName = parts[1]
                targets.amount = parseInt(parts[2])
            }
        })
    })
}

main()
