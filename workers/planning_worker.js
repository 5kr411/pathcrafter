const { parentPort } = require('worker_threads')

const planner = require('../planner')
const { generateTopNPathsFromGenerators } = require('../path_generators/generateTopN')
const { hoistMiningInPaths } = require('../path_optimizations/hoistMining')
const { setGenericWoodEnabled } = require('../utils/config')

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'plan') return
  const { id, mcVersion, item, count, inventory, snapshot, perGenerator, disableGenericWood } = msg

  try {
    if (disableGenericWood === true) setGenericWoodEnabled(false)

    const mcData = planner._internals.resolveMcData(mcVersion || '1.20.1')
    const tree = planner(mcData, item, count, { inventory, log: false })
    const candidates = generateTopNPathsFromGenerators(tree, { inventory }, Number.isFinite(perGenerator) ? perGenerator : 200)
    const ranked = hoistMiningInPaths(candidates)

    parentPort.postMessage({ type: 'result', id, ok: true, ranked })
  } catch (err) {
    parentPort.postMessage({ type: 'result', id, ok: false, error: (err && err.stack) ? err.stack : String(err) })
  }
})


