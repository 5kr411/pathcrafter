const { parentPort, Worker } = require('worker_threads')
const path = require('path')

const planner = require('../planner')
const { getPlanningTelemetryEnabled, setPlanningTelemetryEnabled } = require('../utils/config')
const { dedupePaths } = require('../path_generators/generateTopN')
const { computePathWeight } = require('../utils/pathUtils')
const { hoistMiningInPaths } = require('../path_optimizations/hoistMining')
const { setGenericWoodEnabled } = require('../utils/config')

parentPort.on('message', async (msg) => {
  if (!msg || msg.type !== 'plan') return
  const { id, mcVersion, item, count, inventory, snapshot, perGenerator, disableGenericWood, pruneWithWorld, telemetry } = msg

  try {
    if (disableGenericWood === true) setGenericWoodEnabled(false)
    if (typeof telemetry !== 'undefined') setPlanningTelemetryEnabled(!!telemetry)

    const t0 = Date.now()
    const mcData = planner._internals.resolveMcData(mcVersion || '1.20.1')
    const tBuildStart = Date.now()
    const tree = planner(mcData, item, count, { inventory, log: false, pruneWithWorld: !!pruneWithWorld, worldSnapshot: snapshot })
    const tBuildMs = Date.now() - tBuildStart
    if (getPlanningTelemetryEnabled()) logger.info(`PlanningWorker: built tree in ${tBuildMs} ms for ${item} x${count}`)
    const limit = Number.isFinite(perGenerator) ? perGenerator : 200
    const workerPath = path.resolve(__dirname, './enumerator_worker.js')

    function runEnum(gen) {
      return new Promise((resolve) => {
        const started = Date.now()
        try {
          const w = new Worker(workerPath)
          w.once('message', (msg) => {
            try { w.terminate() } catch (_) {}
            const ok = msg && msg.type === 'result' && msg.ok === true
            const paths = ok && Array.isArray(msg.paths) ? msg.paths : []
            const dt = Date.now() - started
            if (getPlanningTelemetryEnabled()) logger.info(`PlanningWorker: enum[${gen}] finished in ${dt} ms (${paths.length} paths)`) 
            resolve(paths)
          })
          w.once('error', () => { try { w.terminate() } catch (_) {} resolve([]) })
          w.postMessage({ type: 'enumerate', generator: gen, tree, inventory, limit })
        } catch (_) { resolve([]) }
      })
    }

    const tEnumStart = Date.now()
    const [a, s, l] = await Promise.all([runEnum('action'), runEnum('shortest'), runEnum('lowest')])
    const tEnumMs = Date.now() - tEnumStart
    if (getPlanningTelemetryEnabled()) logger.info(`PlanningWorker: enumerated paths in ${tEnumMs} ms (action=${a.length}, shortest=${s.length}, lowest=${l.length})`)
    const tFilterStart = Date.now()
    const merged = dedupePaths([].concat(a, s, l))
    // Tie-break equal weight paths using average distance score if snapshot provided
    if (snapshot && snapshot.blocks && typeof snapshot.blocks === 'object') {
      const { computePathResourceDemand } = require('../path_filters/worldResources')
      const { computePathWeight } = require('../utils/pathUtils')
const logger = require('../utils/logger')
      function distScore(path) {
        try {
          const demand = computePathResourceDemand(path)
          let total = 0, cnt = 0
          if (demand && demand.blocks && demand.blocks.forEach) {
            demand.blocks.forEach((need, name) => {
              const rec = snapshot.blocks[name]
              const avg = rec && Number.isFinite(rec.averageDistance) ? rec.averageDistance : null
              if (avg != null) { total += avg * Math.max(1, need || 1); cnt += Math.max(1, need || 1) }
            })
          }
          return cnt > 0 ? (total / cnt) : Number.POSITIVE_INFINITY
        } catch (_) { return Number.POSITIVE_INFINITY }
      }
      merged.sort((x, y) => {
        const wx = computePathWeight(x), wy = computePathWeight(y)
        if (wx !== wy) return wx - wy
        return distScore(x) - distScore(y)
      })
    } else {
      merged.sort((x, y) => computePathWeight(x) - computePathWeight(y))
    }
    const ranked = hoistMiningInPaths(merged)
    const tFilterMs = Date.now() - tFilterStart
    if (getPlanningTelemetryEnabled()) logger.info(`PlanningWorker: filtered candidates in ${tFilterMs} ms; ${merged.length} total candidates`)

    try {
      const top = ranked && ranked[0]
      if (getPlanningTelemetryEnabled()) {
        if (top && planner && planner._internals && typeof planner._internals.logActionPath === 'function') {
          logger.info('PlanningWorker: final path:')
          planner._internals.logActionPath(top)
        }
      }
    } catch (_) {}

    if (getPlanningTelemetryEnabled()) logger.info(`PlanningWorker: end-to-end planning took ${Date.now() - t0} ms`)
    parentPort.postMessage({ type: 'result', id, ok: true, ranked })
  } catch (err) {
    parentPort.postMessage({ type: 'result', id, ok: false, error: (err && err.stack) ? err.stack : String(err) })
  }
})


