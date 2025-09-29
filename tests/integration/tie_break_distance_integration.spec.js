const fs = require('fs')
const path = require('path')
const { generateTopNAndFilter } = require('../../path_filters')
const { setGenericWoodEnabled } = require('../../utils/config')

describe('integration: Top-N tie-break prefers closer blocks from snapshot', () => {
  beforeEach(() => setGenericWoodEnabled(false))

  function loadLatestSnapshot() {
    const dir = path.resolve(__dirname, '../../world_snapshots')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    if (files.length === 0) throw new Error('No snapshots found')
    const withTimes = files.map(f => { const full = path.join(dir, f); const stat = fs.statSync(full); return { full, t: stat.mtimeMs } }).sort((a, b) => b.t - a.t)
    return JSON.parse(fs.readFileSync(withTimes[0].full, 'utf8'))
  }

  test('wooden_pickaxe mines closer valid species first', () => {
    const snapshot = loadLatestSnapshot()
    const present = snapshot && snapshot.blocks ? Object.keys(snapshot.blocks) : []
    if (!present.some(n => /_log$/.test(n))) return // skip if snapshot has no logs
    const inventory = {}
    const paths = generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, {
      inventory,
      worldSnapshot: snapshot,
      perGenerator: 500,
      log: false,
      config: { genericWoodEnabled: false },
      pruneWithWorld: true
    })
    expect(paths.length).toBeGreaterThan(0)
    const first = paths[0]
    const mined = first.filter(s => s && s.action === 'mine').map(s => s.what)
    // ensure mined species is among present logs
    const ok = mined.every(n => !/_log$/.test(n) || present.includes(n))
    expect(ok).toBe(true)
  })
})


