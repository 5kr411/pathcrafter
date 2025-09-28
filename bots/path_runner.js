const mineflayer = require('mineflayer')
const { BotStateMachine } = require('mineflayer-statemachine')
const { buildStateMachineForPath } = require('../behavior_generator/buildMachine')

let botOptions = { host: 'localhost', port: 25565, username: 'path_runner' }
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2]
  botOptions.port = parseInt(process.argv[3])
  if (process.argv[4]) botOptions.username = process.argv[4]
  if (process.argv[5]) botOptions.password = process.argv[5]
}

const bot = mineflayer.createBot(botOptions)
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder)

bot.once('spawn', () => {
  const hardcodedPath = [
    { action: 'mine', what: 'spruce_log', targetItem: 'spruce_log', count: 3 },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'spruce_planks', perCraftCount: 4 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'crafting_table', perCraftCount: 1 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'spruce_planks', perCraftCount: 4 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'stick', perCraftCount: 4 } },
    { action: 'craft', what: 'inventory', count: 1, result: { item: 'spruce_planks', perCraftCount: 4 } },
    { action: 'craft', what: 'table', count: 1, result: { item: 'wooden_pickaxe', perCraftCount: 1 } }
  ]

  let sm = null

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (message.trim() === 'go') {
      console.log('PathRunner: building state machine for hardcoded path...')
      sm = buildStateMachineForPath(bot, hardcodedPath)
      console.log('PathRunner: starting state machine')
      new BotStateMachine(bot, sm)
    }
  })
})


