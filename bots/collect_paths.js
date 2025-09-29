const mineflayer = require('mineflayer')
const { BotStateMachine } = require('mineflayer-statemachine')
const minecraftData = require('minecraft-data')

const { buildStateMachineForPath } = require('../behavior_generator/buildMachine')
const planner = require('../planner')
const { generateTopNPathsFromGenerators } = require('../path_generators/generateTopN')
const { hoistMiningInPaths } = require('../path_optimizations/hoistMining')
const { filterPathsByWorldSnapshot } = require('../path_filters/filterByWorld')
const { captureRawWorldSnapshot } = require('../utils/worldSnapshot')
const { setGenericWoodEnabled } = require('../utils/config')

function getInventoryObject(bot) {
  const out = {}
  try {
    const items = bot.inventory?.items() || []
    for (const it of items) {
      if (!it || !it.name || !Number.isFinite(it.count)) continue
      out[it.name] = (out[it.name] || 0) + it.count
    }
  } catch (_) {}
  return out
}

let botOptions = { host: 'localhost', port: 25565, username: 'collector' }
if (process.argv.length >= 4) {
  botOptions.host = process.argv[2]
  botOptions.port = parseInt(process.argv[3])
  if (process.argv[4]) botOptions.username = process.argv[4]
  if (process.argv[5]) botOptions.password = process.argv[5]
}

const bot = mineflayer.createBot(botOptions)
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder)

bot.once('spawn', () => {
  setGenericWoodEnabled(false)
  bot.chat('collector ready')

  let running = false
  let lastRequest = null

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    const m = message.trim()
    const parts = m.split(/\s+/)
    if (parts[0] !== 'collect' && parts[0] !== 'go') return

    let item = parts[1]
    let count = Number.parseInt(parts[2])

    if (parts[0] === 'go') {
      if (!lastRequest) { bot.chat('no previous collect request'); return }
      item = lastRequest.item
      count = lastRequest.count
    }

    if (!item || !Number.isFinite(count) || count <= 0) { bot.chat('usage: collect <item> <count>'); return }
    lastRequest = { item, count }

    if (running) { bot.chat('already running, please wait'); return }
    running = true

    const version = bot.version || '1.20.1'
    const mcData = minecraftData(version)

    const invObj = getInventoryObject(bot)

    // Build planning tree
    const tree = planner(mcData, item, count, { inventory: invObj, log: false })

    // Generate candidate paths (top-N from multiple generators)
    const perGenerator = 5000
    const candidates = generateTopNPathsFromGenerators(tree, { inventory: invObj }, perGenerator)

    // Capture in-memory world snapshot (no disk IO) and filter
    const snapshot = captureRawWorldSnapshot(bot, { chunkRadius: 8 })
    const filtered = filterPathsByWorldSnapshot(candidates, snapshot, { disableGenericWood: true })
    const ranked = hoistMiningInPaths(filtered)

    if (!ranked || ranked.length === 0) { bot.chat('no viable paths found'); running = false; return }

    const best = ranked[0]
    bot.chat(`executing plan with ${best.length} steps`)

    const sm = buildStateMachineForPath(bot, best, () => { running = false; bot.chat('plan complete') })
    new BotStateMachine(bot, sm)
  })
})


