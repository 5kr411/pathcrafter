const mineflayer = require('mineflayer')

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  BotStateMachine,
} = require('mineflayer-statemachine')

const createCollectBlockState = require('../behaviors/behaviorCollectBlock')

let botOptions = {
  host: 'localhost',
  port: 25565,
  username: 'mine_block_bot'
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
  const collect = new createCollectBlockState(bot, targets)
  const exit = new BehaviorIdle()

  const startTransition = new StateTransition({
    name: 'mine-block: enter -> collect',
    parent: enter,
    child: collect,
    shouldTransition: () => false,
    onTransition: () => {
      if (!targets.blockName) targets.blockName = 'stone'
      if (!targets.itemName) targets.itemName = 'cobblestone'
      if (!targets.amount) targets.amount = 1
      bot.chat(`Starting mine: ${targets.amount} ${targets.itemName} from ${targets.blockName}`)
    }
  })

  const collectToExit = new StateTransition({
    name: 'mine-block: collect -> exit',
    parent: collect,
    child: exit,
    shouldTransition: () => collect.isFinished && collect.isFinished(),
    onTransition: () => {
      bot.chat('Mining complete (or timed out)')
    }
  })

  const exitToEnter = new StateTransition({
    name: 'mine-block: exit -> enter',
    parent: exit,
    child: enter,
    shouldTransition: () => false
  })

  const transitions = [startTransition, collectToExit, exitToEnter]
  const root = new NestedStateMachine(transitions, enter)
  root.name = 'mine_block_root'

  // Wire chat control: wait for "go"
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (message.trim() === 'go') {
      exitToEnter.trigger()
      startTransition.trigger()
    }
    const parts = message.split(' ')
    if (parts[0] === 'block' && parts[1]) targets.blockName = parts[1]
    if (parts[0] === 'item' && parts[1]) targets.itemName = parts[1]
    if (parts[0] === 'amount' && parts[1]) targets.amount = parseInt(parts[1])
  })

  new BotStateMachine(bot, root)
})


