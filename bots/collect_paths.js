const mineflayer = require('mineflayer')
const { BotStateMachine } = require('mineflayer-statemachine')
const minecraftData = require('minecraft-data')

const { buildStateMachineForPath } = require('../behavior_generator/buildMachine')
const planner = require('../planner')
const { generateTopNPathsFromGenerators } = require('../path_generators/generateTopN')
const { hoistMiningInPaths } = require('../path_optimizations/hoistMining')
const { filterPathsByWorldSnapshot } = require('../path_filters/filterByWorld')
const { beginSnapshotScan, stepSnapshotScan, snapshotFromState, scanProgressFromState } = require('../utils/worldSnapshot')
const { setLastSnapshotRadius } = require('../utils/context')
const { setSafeFindRepeatThreshold } = require('../utils/config')
const logger = require('../utils/logger')
// Centralized tunables for this bot. Adjust here.
const RUNTIME = {
  pruneWithWorld: true,
  perGenerator: 1000,
  snapshotRadius: 64,
  snapshotStep: null,
  snapshotYHalf: null,
  telemetry: true,
  progressLogIntervalMs: 250,
  safeFindRepeatThreshold: 10
}

const { Worker } = require('worker_threads')
const path = require('path')

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
  if (Number.isFinite(RUNTIME.safeFindRepeatThreshold)) {
    setSafeFindRepeatThreshold(Math.max(1, Math.floor(RUNTIME.safeFindRepeatThreshold)))
  }
  const safeChat = (msg) => { try { if (bot && bot._client && !bot._client.ended) bot.chat(msg) } catch (_) {} }
  let connected = true
  bot.on('kicked', (reason) => { connected = false; logger.info('Collector: kicked', reason) })
  bot.on('end', () => { connected = false; logger.info('Collector: connection ended') })
  bot.on('error', (err) => { logger.info('Collector: bot error', err && err.code ? err.code : err) })
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
        // Treat as success if inventory already satisfies the target request
        try {
          const target = entry && entry.target ? entry.target : null
          const invNow = getInventoryObject(bot)
          let have = 0
          if (target && target.item) {
            const name = String(target.item)
            if (name.startsWith('generic_')) {
              const base = name.slice('generic_'.length)
              try {
                const mcDataNow = minecraftData(bot.version || '1.20.1')
                const speciesTokens = new Set()
                try {
                  const { ensureWoodSpeciesTokens } = require('../utils/wood')
                  const ensured = ensureWoodSpeciesTokens(mcDataNow)
                  ensured && ensured.forEach && ensured.forEach(t => speciesTokens.add(t))
                } catch (_) {}
                for (const [k, v] of Object.entries(invNow)) {
                  const idx = k.lastIndexOf('_')
                  if (idx <= 0) continue
                  const prefix = k.slice(0, idx)
                  const suffix = k.slice(idx + 1)
                  if (suffix === base && speciesTokens.has(prefix)) have += v
                }
              } catch (_) {}
            } else {
              have = invNow[name] || 0
            }
          }
          if (target && Number.isFinite(target.count) && have >= target.count) {
            running = false
            safeChat('target already satisfied')
            try { startNextTarget() } catch (_) {}
            return
          }
        } catch (_) {}
        running = false
        safeChat('no viable paths found')
        return
      }
      const best = ranked[0]
      safeChat(`executing plan with ${best.length} steps`)
      try {
        const mcData = minecraftData(bot.version || '1.20.1')
        const center = bot.entity && bot.entity.position ? bot.entity.position : null
        // New snapshot format: map of name -> stats
        const blocks = entry && entry.snapshot && entry.snapshot.blocks && typeof entry.snapshot.blocks === 'object' ? entry.snapshot.blocks : {}
        const resolved = best.map(s => s)
        logger.info('Collector: selected path (resolved):')
        if (planner && planner._internals && typeof planner._internals.logActionPath === 'function') {
          planner._internals.logActionPath(resolved)
        } else {
          logger.info(JSON.stringify(resolved))
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
    if (Number.isFinite(RUNTIME.snapshotStep) && RUNTIME.snapshotStep > 0) {
      snapOpts.step = Math.floor(RUNTIME.snapshotStep)
    }
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
    let lastProgressLog = 0
    while (!(await stepSnapshotScan(scan, budgetMs))) {
      if (!connected) { running = false; return }
      if (RUNTIME.telemetry && Date.now() - lastProgressLog > (Number.isFinite(RUNTIME.progressLogIntervalMs) ? RUNTIME.progressLogIntervalMs : 1000)) {
        const ratio = scanProgressFromState(scan)
        const pct = Math.min(100, Math.max(0, Math.floor(ratio * 100)))
        logger.info(`Collector: snapshot progress ~${pct}% (r=${Math.min(scan.r, scan.maxRadius)}/${scan.maxRadius})`)
        lastProgressLog = Date.now()
      }
      await new Promise(resolve => setTimeout(resolve, sleepBetween))
    }
    const snapshot = snapshotFromState(scan)
    try { setLastSnapshotRadius(snapshot && Number.isFinite(snapshot.radius) ? snapshot.radius : (snapOpts && snapOpts.radius)) } catch (_) {}
    if (RUNTIME.telemetry) {
      const dur = Date.now() - tSnapStart
      logger.info(`Collector: snapshot captured in ${dur} ms (radius=${snapOpts.radius}${Number.isFinite(snapOpts.yMin) ? `, yMin=${snapOpts.yMin}, yMax=${snapOpts.yMax}` : ''})`)
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


