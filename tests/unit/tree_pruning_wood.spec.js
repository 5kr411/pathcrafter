const plan = require('../../planner')
const { setGenericWoodEnabled } = require('../../utils/config')

describe('unit: tree pruning with wood snapshot (generic disabled)', () => {
  const ctx = '1.20.1'

  beforeEach(() => { setGenericWoodEnabled(false) })

  test('wooden_pickaxe does not include mining crafting_table when none in world', () => {
    const inventory = {}
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 3, yMin: 0, yMax: 255,
      blocks: { spruce_log: { count: 10, closestDistance: 5, averageDistance: 12 } }, entities: {}
    }
    const tree = plan(ctx, 'wooden_pickaxe', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snapshot })
    const paths = Array.from(plan._internals.enumerateActionPathsGenerator(tree, { inventory }))
    const hasMineCraftingTable = paths.some(seq => seq.some(s => s.action === 'mine' && s.what === 'crafting_table'))
    expect(hasMineCraftingTable).toBe(false)
  })

  test('wooden_pickaxe logs mining is limited to species in snapshot', () => {
    const inventory = {}
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 3, yMin: 0, yMax: 255,
      blocks: { spruce_log: { count: 10, closestDistance: 5, averageDistance: 12 } }, entities: {}
    }
    const tree = plan(ctx, 'wooden_pickaxe', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snapshot })
    const paths = Array.from(plan._internals.enumerateActionPathsGenerator(tree, { inventory }))
    const forbidden = ['pale_oak_log','oak_log','birch_log','jungle_log','acacia_log','dark_oak_log','cherry_log','mangrove_log']
    const hasForbiddenLogMine = paths.some(seq => seq.some(s => s.action === 'mine' && forbidden.includes(s.what)))
    expect(hasForbiddenLogMine).toBe(false)
  })
})


