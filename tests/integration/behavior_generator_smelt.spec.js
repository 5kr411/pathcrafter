const analyzeRecipes = require('../../recipeAnalyzer')
const { buildStateMachineForPath } = require('../../behavior_generator/buildMachine')

describe('integration: behavior_generator smelt', () => {
  const { resolveMcData, enumerateShortestPathsGenerator } = analyzeRecipes._internals
  const mcData = resolveMcData('1.20.1')

  test('creates behavior for a smelt leaf step from planner path', () => {
    const inventory = { furnace: 1, coal: 1, raw_iron: 1 }
    const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory })
    // Use shortest paths generator and just take the first path - much faster
    const [path] = Array.from(enumerateShortestPathsGenerator(tree, { inventory }))
    expect(path).toBeDefined()
    const found = path.find(s => s.action === 'smelt' && s.result?.item === 'iron_ingot')
    expect(found).toBeTruthy()
    // Smoke build of state machine (no runtime execution here)
    const fakeBot = {}
    const sm = buildStateMachineForPath(fakeBot, [found], () => {})
    expect(sm).toBeTruthy()
  })
})


