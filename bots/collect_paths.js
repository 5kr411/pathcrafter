const mineflayer = require('mineflayer')
const { BotStateMachine } = require('mineflayer-statemachine')
const minecraftData = require('minecraft-data')

const { buildStateMachineForPath } = require('../behavior_generator/buildMachine')
const planner = require('../planner')
const { generateTopNPathsFromGenerators } = require('../path_generators/generateTopN')
const { hoistMiningInPaths } = require('../path_optimizations/hoistMining')
const { filterPathsByWorldSnapshot } = require('../path_filters/filterByWorld')
const { beginSnapshotScan, stepSnapshotScan, snapshotFromState } = require('../utils/worldSnapshot')
const { setGenericWoodEnabled, setSafeFindRepeatThreshold } = require('../utils/config')
// Centralized tunables for this bot. Adjust here.
const RUNTIME = {
  genericWoodEnabled: false,
  pruneWithWorld: true,
  perGenerator: 5000,
  snapshotRadius: 100,
  snapshotYHalf: null,
  telemetry: true,
  safeFindRepeatThreshold: 10
}

const { Worker } = require('worker_threads')
const path = require('path')
const { resolveWoodFlexibleName, resolveWithSnapshotFlexibleName } = require('../utils/woodRuntime')

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
// Apply runtime config

bot.once('spawn', () => {
  setGenericWoodEnabled(RUNTIME.genericWoodEnabled)
  if (Number.isFinite(RUNTIME.safeFindRepeatThreshold)) {
    setSafeFindRepeatThreshold(Math.max(1, Math.floor(RUNTIME.safeFindRepeatThreshold)))
  }
  const safeChat = (msg) => { try { if (bot && bot._client && !bot._client.ended) bot.chat(msg) } catch (_) {} }
  let connected = true
  bot.on('kicked', (reason) => { connected = false; console.log('Collector: kicked', reason) })
  bot.on('end', () => { connected = false; console.log('Collector: connection ended') })
  bot.on('error', (err) => { console.log('Collector: bot error', err && err.code ? err.code : err) })
  safeChat('collector ready')

  let running = false
let lastRequest = null
let lastSequence = null
  let worker = null
  let pending = new Map()
let sequenceTargets = []
let sequenceIndex = 0

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
        safeChat('planning failed')
        return
      }
      const ranked = Array.isArray(msg.ranked) ? msg.ranked : []
      if (ranked.length === 0) {
        running = false
        bot.chat('no viable paths found')
        return
      }
      const best = ranked[0]
      safeChat(`executing plan with ${best.length} steps`)
      try {
        const mcData = minecraftData(bot.version || '1.20.1')
        const center = bot.entity && bot.entity.position ? bot.entity.position : null
        // New snapshot format: map of name -> stats
        const blocks = entry && entry.snapshot && entry.snapshot.blocks && typeof entry.snapshot.blocks === 'object' ? entry.snapshot.blocks : {}
        const resolved = best.map((s) => {
          if (!s || typeof s !== 'object') return s
          const copy = { ...s }
          if (copy.action === 'mine') {
            if (copy.what) copy.what = resolveWithSnapshotFlexibleName(mcData, copy.what, blocks, { center })
            if (copy.targetItem) copy.targetItem = resolveWithSnapshotFlexibleName(mcData, copy.targetItem, blocks, { center })
          } else if (copy.action === 'craft' && copy.result && copy.result.item) {
            const meta = copy.result.meta || {}
            if (meta && meta.selectedSpecies) {
              // keep species-specific as-is
            } else if (meta && meta.generic === true) {
              copy.result = { ...copy.result, item: resolveWithSnapshotFlexibleName(mcData, copy.result.item, blocks, { center }) }
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
      if (!connected) { running = false; return }
      const sm = buildStateMachineForPath(bot, best, () => {
        running = false
        safeChat('plan complete')
        // Advance to next target if present
        try { startNextTarget() } catch (_) {}
      })
      new BotStateMachine(bot, sm)
    })
    worker.on('error', () => { running = false })
    worker.on('exit', () => { worker = null; pending.clear(); running = false })
    return worker
  }

  function parseTargetsFromMessage(message) {
    const afterCmd = message.replace(/^\s*(collect|go)\s*/i, '')
    return afterCmd.split(',').map(seg => seg.trim()).filter(Boolean).map(seg => {
      const parts = seg.split(/\s+/).filter(Boolean)
      const item = parts[0]
      const count = Number.parseInt(parts[1])
      return (item && Number.isFinite(count) && count > 0) ? { item, count } : null
    }).filter(Boolean)
  }

  async function startNextTarget() {
    if (running) return
    if (!Array.isArray(sequenceTargets) || sequenceTargets.length === 0) return
    if (sequenceIndex >= sequenceTargets.length) {
      safeChat('all targets complete')
      sequenceTargets = []
      sequenceIndex = 0
      return
    }
    const target = sequenceTargets[sequenceIndex]
    sequenceIndex++
    const version = bot.version || '1.20.1'
    const invObj = getInventoryObject(bot)
    const snapOpts = { radius: RUNTIME.snapshotRadius }
    if (Number.isFinite(RUNTIME.snapshotYHalf)) {
      const y0 = Math.floor((bot.entity && bot.entity.position && bot.entity.position.y) || 64)
      snapOpts.yMin = y0 - RUNTIME.snapshotYHalf
      snapOpts.yMax = y0 + RUNTIME.snapshotYHalf
    }
    const tSnapStart = Date.now()
    const scan = beginSnapshotScan(bot, snapOpts)
    // Time-sliced scanning loop with inter-step yielding to avoid keepalive timeouts
    const budgetMs = 10
    const sleepBetween = 20
    let lastProgressLog = Date.now()
    while (!(await stepSnapshotScan(scan, budgetMs))) {
      if (!connected) { running = false; return }
      if (RUNTIME.telemetry && Date.now() - lastProgressLog > 1000) {
        const pct = Math.min(100, Math.floor((scan.r / scan.maxRadius) * 100))
        console.log(`Collector: snapshot progress ~${pct}% (r=${Math.min(scan.r, scan.maxRadius)}/${scan.maxRadius})`)
        lastProgressLog = Date.now()
      }
      await new Promise(resolve => setTimeout(resolve, sleepBetween))
    }
    const snapshot = snapshotFromState(scan)
    if (RUNTIME.telemetry) {
      const dur = Date.now() - tSnapStart
      console.log(`Collector: snapshot captured in ${dur} ms (radius=${snapOpts.radius}${Number.isFinite(snapOpts.yMin) ? `, yMin=${snapOpts.yMin}, yMax=${snapOpts.yMax}` : ''})`)
    }
    const id = `${Date.now()}_${Math.random()}`
    ensureWorker()
    pending.set(id, { snapshot, target })
    running = true
    worker.postMessage({
      type: 'plan',
      id,
      mcVersion: version,
      item: target.item,
      count: target.count,
      inventory: invObj,
      snapshot,
      perGenerator: RUNTIME.perGenerator,
      disableGenericWood: !RUNTIME.genericWoodEnabled,
      pruneWithWorld: RUNTIME.pruneWithWorld,
      telemetry: RUNTIME.telemetry
    })
  }

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    const m = message.trim()
    const parts = m.split(/\s+/)
    if (parts[0] !== 'collect' && parts[0] !== 'go') return

    if (parts[0] === 'go') {
      if (!Array.isArray(lastSequence) || lastSequence.length === 0) { safeChat('no previous collect request'); return }
      sequenceTargets = lastSequence.slice()
      sequenceIndex = 0
      if (running) { safeChat('already running, please wait'); return }
      startNextTarget().catch(() => {})
      return
    }

    const parsed = parseTargetsFromMessage(message)
    if (!parsed || parsed.length === 0) { safeChat('usage: collect <item> <count>[, <item> <count> ...]'); return }
    lastSequence = parsed.slice()
    sequenceTargets = parsed.slice()
    sequenceIndex = 0
    if (running) { safeChat('already running, please wait'); return }
    startNextTarget().catch(() => {})
  })
})


