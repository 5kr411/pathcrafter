const { parentPort } = require('worker_threads')

const planner = require('../planner')

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'enumerate') return
  const { generator, tree, inventory, limit } = msg
  try {
    let enumerate
    if (generator === 'action') enumerate = planner._internals.enumerateActionPathsGenerator
    else if (generator === 'shortest') enumerate = planner._internals.enumerateShortestPathsGenerator
    else if (generator === 'lowest') enumerate = planner._internals.enumerateLowestWeightPathsGenerator
    else throw new Error('Unknown generator type: ' + generator)

    const out = []
    const iter = enumerate(tree, { inventory })
    let i = 0
    for (const p of iter) {
      out.push(p)
      i += 1
      if (Number.isFinite(limit) && i >= limit) break
    }
    parentPort.postMessage({ type: 'result', ok: true, paths: out })
  } catch (err) {
    parentPort.postMessage({ type: 'result', ok: false, error: (err && err.stack) ? err.stack : String(err) })
  }
})


