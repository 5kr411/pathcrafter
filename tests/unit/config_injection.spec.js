const plan = require('../../planner')
const { setGenericWoodEnabled, getGenericWoodEnabled } = require('../../utils/config')

describe('unit: config injection overrides global generic wood flag', () => {
  const ctx = '1.20.1'

  beforeEach(() => {
    setGenericWoodEnabled(true)
  })

  test('genericWoodEnabled=false in context disables generic ingredients even if global is true', () => {
    const mc = plan._internals.resolveMcData(ctx)
    const tree = plan(mc, 'crafting_table', 1, { log: false, inventory: {}, config: { genericWoodEnabled: false } })

    // Find the craft node for crafting_table
    const craftNode = (tree.children || []).find(ch => ch && ch.action === 'craft')
    expect(!!craftNode).toBe(true)
    const ingredients = craftNode && craftNode.ingredients ? craftNode.ingredients : []
    // Ensure none of the ingredients are marked generic
    const anyGeneric = ingredients.some(i => i && i.meta && i.meta.generic === true)
    expect(anyGeneric).toBe(false)
  })
})


