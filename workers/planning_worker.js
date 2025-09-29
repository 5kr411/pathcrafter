const { parentPort, Worker } = require('worker_threads')
const path = require('path')

const planner = require('../planner')
const { dedupePaths } = require('../path_generators/generateTopN')
const { computePathWeight } = require('../utils/pathUtils')
const { hoistMiningInPaths } = require('../path_optimizations/hoistMining')
const { setGenericWoodEnabled } = require('../utils/config')

parentPort.on('message', async (msg) => {
  if (!msg || msg.type !== 'plan') return
  const { id, mcVersion, item, count, inventory, snapshot, perGenerator, disableGenericWood, pruneWithWorld } = msg

  try {
    if (disableGenericWood === true) setGenericWoodEnabled(false)

    const mcData = planner._internals.resolveMcData(mcVersion || '1.20.1')
    const tree = planner(mcData, item, count, { inventory, log: false, pruneWithWorld: !!pruneWithWorld, worldSnapshot: snapshot })
    const limit = Number.isFinite(perGenerator) ? perGenerator : 200
    const workerPath = path.resolve(__dirname, './enumerator_worker.js')

    function runEnum(gen) {
      return new Promise((resolve) => {
        try {
          const w = new Worker(workerPath)
          w.once('message', (msg) => {
            try { w.terminate() } catch (_) {}
            if (!msg || msg.type !== 'result' || msg.ok !== true) return resolve([])
            resolve(Array.isArray(msg.paths) ? msg.paths : [])
          })
          w.once('error', () => { try { w.terminate() } catch (_) {} resolve([]) })
          w.postMessage({ type: 'enumerate', generator: gen, tree, inventory, limit })
        } catch (_) { resolve([]) }
      })
    }

    const [a, s, l] = await Promise.all([runEnum('action'), runEnum('shortest'), runEnum('lowest')])
    const merged = dedupePaths([].concat(a, s, l))
    // Tie-break equal weight paths using average distance score if snapshot provided
    if (snapshot && snapshot.blocks && typeof snapshot.blocks === 'object') {
      const { computePathResourceDemand } = require('../path_filters/worldResources')
      const { computePathWeight } = require('../utils/pathUtils')
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

    parentPort.postMessage({ type: 'result', id, ok: true, ranked })
  } catch (err) {
    parentPort.postMessage({ type: 'result', id, ok: false, error: (err && err.stack) ? err.stack : String(err) })
  }
})


