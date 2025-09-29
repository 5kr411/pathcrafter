const fs = require('fs')
const path = require('path')
const plan = require('../../planner')
const { enumerateLowestWeightPathsGenerator } = require('../../path_generators/lowestWeightPathsGenerator')
const { setGenericWoodEnabled } = require('../../utils/config')

describe('integration: world pruning with real dumped snapshot (generic disabled)', () => {
  const ctx = '1.20.1'

  beforeEach(() => { setGenericWoodEnabled(false) })

  function loadLatestSnapshot() {
    const dir = path.resolve(__dirname, '../../world_snapshots')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    if (files.length === 0) throw new Error('No snapshots found')
    const withTimes = files.map(f => {
      const full = path.join(dir, f)
      const stat = fs.statSync(full)
      return { full, t: stat.mtimeMs }
    }).sort((a, b) => b.t - a.t)
    return JSON.parse(fs.readFileSync(withTimes[0].full, 'utf8'))
  }

  test('wooden_pickaxe plan avoids species not present in snapshot', () => {
    const snapshot = loadLatestSnapshot()
    const inventory = {}
    const tree = plan(ctx, 'wooden_pickaxe', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snapshot })
    const lw = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory }))
    const present = new Set(Object.keys(snapshot.blocks || {}))
    const forbiddenLog = ['oak_log','pale_oak_log','birch_log','jungle_log','acacia_log','dark_oak_log','cherry_log','mangrove_log'].filter(n => !present.has(n))
    const invalid = lw.some(seq => seq.some(s => s.action === 'mine' && forbiddenLog.includes(s.what)))
    expect(invalid).toBe(false)
  })
})


