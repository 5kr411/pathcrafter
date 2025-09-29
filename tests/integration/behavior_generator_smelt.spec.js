const analyzeRecipes = require('../../recipeAnalyzer')
const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine')

describe('integration: behavior_generator smelt', () => {
  const { resolveMcData, enumerateActionPathsGenerator } = analyzeRecipes._internals
  const mcData = resolveMcData('1.20.1')

  test('creates behavior for a smelt leaf step from planner path', () => {
    const inventory = { furnace: 1, coal: 1, raw_iron: 1 }
    const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory })
    let found = null
    for (const path of enumerateActionPathsGenerator(tree, { inventory })) {
      found = path.find(s => s.action === 'smelt' && s.result?.item === 'iron_ingot')
      if (found) break
    }
    expect(found).toBeTruthy()
    // Smoke build of state machine (no runtime execution here)
    const fakeBot = {}
    const sm = buildStateMachineForPath(fakeBot, [found], () => {})
    expect(sm).toBeTruthy()
  })
})


