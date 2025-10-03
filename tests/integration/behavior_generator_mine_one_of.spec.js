const { createBehaviorForStep } = require('../../behavior_generator')
const { setSafeFindRepeatThreshold } = require('../../utils/config')

describe('integration: behavior_generator mineOneOf', () => {
  beforeEach(() => {
    setSafeFindRepeatThreshold(5)
  })

  test('creates behavior for a mine OR step with oneOfCandidates', () => {
    const step = {
      action: 'mine',
      what: 'generic_log',
      count: 2,
      meta: { oneOfCandidates: [ { blockName: 'oak_log' }, { blockName: 'spruce_log' } ] }
    }
    const mc = require('minecraft-data')('1.20.1')
    const bot = {
      version: '1.20.1',
      inventory: { items: () => [] },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [],
      mcData: mc
    }
    const behavior = createBehaviorForStep(bot, step)
    expect(behavior).toBeTruthy()
  })
})




