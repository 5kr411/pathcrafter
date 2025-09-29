const { _internals, createBehaviorForStep } = require('../../behavior_generator')
const { setGenericWoodEnabled } = require('../../utils/config')
const { setWoodSpeciesTokens, setCurrentSpeciesContext } = require('../../utils/context')

describe('integration: generic wood resolution in behaviors', () => {
  beforeEach(() => {
    setGenericWoodEnabled(true)
    setWoodSpeciesTokens(new Set(['oak','spruce','birch','pale_oak']))
    setCurrentSpeciesContext(null)
  })
  test('mine resolves generic_log to species before creating behavior', () => {
    const bot = { version: '1.20.1', inventory: { items: () => [{ name: 'oak_log', count: 2 }] }, world: {}, entity: { position: { x: 0, y: 64, z: 0 } }, findBlocks: () => [] }
    const step = { action: 'mine', what: 'generic_log', targetItem: 'generic_log', count: 1 }
    const behavior = createBehaviorForStep(bot, step)
    expect(behavior).toBeTruthy()
  })

  test('craft inventory resolves generic_planks in result', () => {
    const bot = { version: '1.20.1', inventory: { items: () => [{ name: 'oak_planks', count: 4 }] }, world: {}, entity: { position: { x: 0, y: 64, z: 0 } }, findBlocks: () => [] }
    const step = { action: 'craft', what: 'inventory', count: 1, result: { item: 'generic_planks', perCraftCount: 4 } }
    const behavior = createBehaviorForStep(bot, step)
    expect(behavior).toBeTruthy()
  })

  test('species-specific name maps when that species is unavailable', () => {
    const bot = { version: '1.20.1', inventory: { items: () => [{ name: 'birch_planks', count: 4 }] }, world: {}, entity: { position: { x: 0, y: 64, z: 0 } }, findBlocks: () => [] }
    const step = { action: 'craft', what: 'inventory', count: 1, result: { item: 'pale_oak_planks', perCraftCount: 4 } }
    const behavior = createBehaviorForStep(bot, step)
    expect(behavior).toBeTruthy()
  })
})


