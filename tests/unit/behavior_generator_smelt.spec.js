const genSmelt = require('../../behavior_generator/smelt')

describe('unit: behavior_generator smelt mapping', () => {
  test('computeTargetsForSmelt extracts result/input/fuel/count', () => {
    const step = { action: 'smelt', what: 'furnace', count: 3, input: { item: 'raw_iron', perSmelt: 1 }, result: { item: 'iron_ingot', perSmelt: 1 }, fuel: 'coal' }
    const t = genSmelt.computeTargetsForSmelt(step)
    expect(t.itemName).toBe('iron_ingot')
    expect(t.amount).toBe(3)
    expect(t.inputName).toBe('raw_iron')
    expect(t.fuelName).toBe('coal')
  })
})


