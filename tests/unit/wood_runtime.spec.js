const { resolveGenericName, resolveWoodFlexibleName } = require('../../utils/woodRuntime')
const { setGenericWoodEnabled } = require('../../utils/config')
const { setWoodSpeciesTokens, setCurrentSpeciesContext } = require('../../utils/context')
const minecraftData = require('minecraft-data')

function makeBot({ inv = [], blocks = [] } = {}) {
  return {
    inventory: { items: () => inv },
    entity: { position: { x: 0, y: 64, z: 0 } },
    findBlocks: ({ matching, maxDistance, count }) => {
      const out = []
      for (const b of blocks) { if (matching(b)) out.push(b.position) }
      return out.slice(0, count || 32)
    }
  }
}

describe('unit: woodRuntime resolver', () => {
  const mc = minecraftData('1.20.1')

  beforeEach(() => {
    setGenericWoodEnabled(true)
    setWoodSpeciesTokens(new Set(['oak','spruce','birch','pale_oak']))
    setCurrentSpeciesContext(null)
  })

  test('returns original when generic disabled', () => {
    setGenericWoodEnabled(false)
    const bot = makeBot()
    const out = resolveGenericName(bot, mc, 'generic_planks')
    expect(out).toBe('generic_planks')
  })

  test('prefers inventory species with highest count', () => {
    const bot = makeBot({ inv: [ { name: 'oak_planks', count: 4 }, { name: 'spruce_planks', count: 8 } ] })
    const out = resolveGenericName(bot, mc, 'generic_planks')
    expect(out).toBe('spruce_planks')
  })

  test('falls back to nearest in-world species when inventory empty', () => {
    // No context set
    setCurrentSpeciesContext(null)
    const blocks = [
      { name: 'oak_log', position: { x: 10, y: 64, z: 0 } },
      { name: 'spruce_log', position: { x: 4, y: 64, z: 0 } }
    ]
    const bot = makeBot({ blocks })
    const out = resolveGenericName(bot, mc, 'generic_planks')
    // Nearest is spruce_log → prefer spruce_planks
    expect(out).toBe('spruce_planks')
  })

  test('uses planner context species when no inventory/world signals', () => {
    setCurrentSpeciesContext('birch')
    const bot = makeBot()
    const out = resolveGenericName(bot, mc, 'generic_planks')
    expect(out).toBe('birch_planks')
  })

  test('defaults to oak when nothing else available', () => {
    const bot = makeBot()
    const out = resolveGenericName(bot, mc, 'generic_log')
    // 1.20.1 has oak_log
    expect(out).toBe('oak_log')
  })

  test('flexible resolver maps species-specific wood to available species', () => {
    // No pale_oak around; inventory has birch
    const bot = makeBot({ inv: [{ name: 'birch_planks', count: 4 }] })
    const out = resolveWoodFlexibleName(bot, mc, 'pale_oak_planks')
    expect(out).toBe('birch_planks')
  })
})


