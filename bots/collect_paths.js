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
const { Worker } = require('worker_threads')
const path = require('path')
const { resolveWoodFlexibleName } = require('../utils/woodRuntime')

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
let genericWoodEnabled = true

bot.once('spawn', () => {
  setGenericWoodEnabled(genericWoodEnabled)
  bot.chat('collector ready')

  let running = false
  let lastRequest = null
  let worker = null
  let pending = new Map()

  function ensureWorker() {
    if (worker) return worker
    const workerPath = path.resolve(__dirname, '../workers/planning_worker.js')
    worker = new Worker(workerPath)
    worker.on('message', (msg) => {
      if (!msg || msg.type !== 'result') return
      const entry = pending.get(msg.id)
      pending.delete(msg.id)
      if (!entry) return
      if (!msg.ok) {
        running = false
        bot.chat('planning failed')
        return
      }
      const ranked = Array.isArray(msg.ranked) ? msg.ranked : []
      if (ranked.length === 0) {
        running = false
        bot.chat('no viable paths found')
        return
      }
      const best = ranked[0]
      bot.chat(`executing plan with ${best.length} steps`)
      try {
        const mcData = minecraftData(bot.version || '1.20.1')
        const resolved = best.map((s) => {
          if (!s || typeof s !== 'object') return s
          const copy = { ...s }
          if (copy.action === 'mine') {
            if (copy.what) copy.what = resolveWoodFlexibleName(bot, mcData, copy.what)
            if (copy.targetItem) copy.targetItem = resolveWoodFlexibleName(bot, mcData, copy.targetItem)
          } else if (copy.action === 'craft' && copy.result && copy.result.item) {
            const meta = copy.result.meta || {}
            if (meta && meta.selectedSpecies) {
              // keep species-specific as-is
            } else if (meta && meta.generic === true) {
              copy.result = { ...copy.result, item: resolveWoodFlexibleName(bot, mcData, copy.result.item) }
            }
          }
          return copy
        })
        console.log('Collector: selected path (resolved):')
        if (planner && planner._internals && typeof planner._internals.logActionPath === 'function') {
          planner._internals.logActionPath(resolved)
        } else {
          console.log(JSON.stringify(resolved))
        }
      } catch (_) {}
      const sm = buildStateMachineForPath(bot, best, () => { running = false; bot.chat('plan complete') })
      new BotStateMachine(bot, sm)
    })
    worker.on('error', () => { running = false })
    worker.on('exit', () => { worker = null; pending.clear(); running = false })
    return worker
  }

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
    const invObj = getInventoryObject(bot)
    const snapshot = captureRawWorldSnapshot(bot, { chunkRadius: 8 })

    const id = `${Date.now()}_${Math.random()}`
    ensureWorker()
    pending.set(id, true)
    worker.postMessage({
      type: 'plan',
      id,
      mcVersion: version,
      item,
      count,
      inventory: invObj,
      snapshot,
      perGenerator: 5000,
      disableGenericWood: !genericWoodEnabled
    })
  })
})


