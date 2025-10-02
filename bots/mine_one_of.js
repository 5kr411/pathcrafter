const mineflayer = require('mineflayer')

const {
  StateTransition,
  BehaviorIdle,
  NestedStateMachine,
  BotStateMachine
} = require('mineflayer-statemachine')

const createMineOneOfState = require('../behaviors/behaviorMineOneOf')

let botOptions = {
  host: 'localhost',
  port: 25565,
  username: 'mine_one_of'
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
  const targets = { candidates: [], amount: 1 }

  const enter = new BehaviorIdle()
  const mine = createMineOneOfState(bot, targets)
  const exit = new BehaviorIdle()

  const start = new StateTransition({
    name: 'mine-one-of: enter -> mine',
    parent: enter,
    child: mine,
    shouldTransition: () => false
  })

  const done = new StateTransition({
    name: 'mine-one-of: mine -> exit',
    parent: mine,
    child: exit,
    shouldTransition: () => typeof mine.isFinished === 'function' ? mine.isFinished() : true
  })

  const back = new StateTransition({ name: 'exit -> enter', parent: exit, child: enter, shouldTransition: () => true })

  const root = new NestedStateMachine([start, done, back], enter)
  root.name = 'mine_one_of_root'

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    const m = message.trim()
    const parts = m.split(/\s+/)
    if (parts[0] !== 'mineof') return
    // usage: mineof <amount> <block1> [block2] [block3] ...
    const amount = parseInt(parts[1])
    const names = parts.slice(2)
    if (!Number.isFinite(amount) || names.length === 0) {
      try { bot.chat('usage: mineof <amount> <block1> [block2] ...') } catch (_) {}
      return
    }
    targets.amount = amount
    targets.candidates = names.map(n => ({ blockName: n, itemName: n, amount }))
    setTimeout(() => start.trigger(), 0)
  })

  // Encourage movement defaults
  try {
    bot.pathfinder.searchRadius = 64
    bot.pathfinder.setMovements(new (require('mineflayer-pathfinder').Movements)(bot, require('minecraft-data')(bot.version)))
  } catch (_) {}

  new BotStateMachine(bot, root)
})




