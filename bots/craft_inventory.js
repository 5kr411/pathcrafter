const mineflayer = require('mineflayer')

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  BotStateMachine,
} = require('mineflayer-statemachine')

const createCraftNoTableState = require('../behaviors/behaviorCraftNoTable')

let botOptions = {
  host: 'localhost',
  port: 25565,
  username: 'craft_inventory_bot'
}

if (process.argv.length >= 4) {
  botOptions.host = process.argv[2]
  botOptions.port = parseInt(process.argv[3])
  if (process.argv[4]) botOptions.username = process.argv[4]
  if (process.argv[5]) botOptions.password = process.argv[5]
}

const bot = mineflayer.createBot(botOptions)
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder)

bot.once('spawn', () => {
  const targets = {}

  const enter = new BehaviorIdle()
  const craftNoTable = new createCraftNoTableState(bot, targets)
  const exit = new BehaviorIdle()

  const startTransition = new StateTransition({
    name: 'craft-inventory: enter -> craft',
    parent: enter,
    child: craftNoTable,
    shouldTransition: () => false,
    onTransition: () => {
      if (!targets.itemName) targets.itemName = 'stick'
      if (!targets.amount) targets.amount = 4
      bot.chat(`Starting craft in inventory: ${targets.amount} ${targets.itemName}`)
    }
  })

  const craftToExit = new StateTransition({
    name: 'craft-inventory: craft -> exit',
    parent: craftNoTable,
    child: exit,
    shouldTransition: () => craftNoTable.isFinished && craftNoTable.isFinished(),
    onTransition: () => {
      bot.chat('Craft in inventory complete (or timed out)')
    }
  })

  const exitToEnter = new StateTransition({
    name: 'craft-inventory: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => true,
    onTransition: () => {
      // reset/keep targets as-is; next startTransition will (re)use them
    }
  })

  const transitions = [startTransition, craftToExit, exitToEnter]
  const root = new NestedStateMachine(transitions, enter)
  root.name = 'craft_inventory_root'

  // Wire chat control: wait for "go"
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (message.trim() === 'go') setTimeout(() => startTransition.trigger(), 0)
    const parts = message.split(' ')
    if (parts[0] === 'item' && parts[1]) targets.itemName = parts[1]
    if (parts[0] === 'amount' && parts[1]) targets.amount = parseInt(parts[1])
  })

  new BotStateMachine(bot, root)
})


