const mineflayer = require('mineflayer')
const { BotStateMachine } = require('mineflayer-statemachine')
const { buildStateMachineForPath } = require('../behavior_generator/buildMachine')
const minecraftData = require('minecraft-data')
const analyzeRecipes = require('../recipeAnalyzer')

let botOptions = { host: 'localhost', port: 25565, username: 'smelt_only' }
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2]
  botOptions.port = parseInt(process.argv[3])
  if (process.argv[4]) botOptions.username = process.argv[4]
  if (process.argv[5]) botOptions.password = process.argv[5]
}

const bot = mineflayer.createBot(botOptions)
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder)

bot.once('spawn', () => {
  bot.chat('smelt_only ready')
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    const m = message.trim().split(/\s+/)
    if (m[0] !== 'smelt') return
    const item = m[1] || 'iron_ingot'
    const count = Number.parseInt(m[2] || '1')
    const mc = minecraftData(bot.version || '1.20.1')
    const inventory = {}
    try { (bot.inventory?.items() || []).forEach(it => { inventory[it.name] = (inventory[it.name] || 0) + it.count }) } catch (_) {}
    const tree = analyzeRecipes(mc, item, count, { log: false, inventory })
    // choose first action path containing a smelt step to requested item
    const { enumerateActionPathsGenerator } = analyzeRecipes._internals
    let chosen = null
    for (const p of enumerateActionPathsGenerator(tree, { inventory })) {
      if (p.some(s => s.action === 'smelt' && s.result?.item === item)) { chosen = p; break }
    }
    if (!chosen) { bot.chat('no smelt path found'); return }
    const sm = buildStateMachineForPath(bot, chosen, () => bot.chat('smelt plan complete'))
    new BotStateMachine(bot, sm)
  })
})


