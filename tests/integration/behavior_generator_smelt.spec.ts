import analyzeRecipes from '../../recipeAnalyzer';
import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';

describe('integration: behavior_generator smelt', () => {
  const { resolveMcData, enumerateShortestPathsGenerator } = (analyzeRecipes as any)._internals;
  const mcData = resolveMcData('1.20.1');

  test('creates behavior for a smelt leaf step from planner path', () => {
    // Provide all needed items to minimize tree generation
    const inventory = { furnace: 1, coal: 5, raw_iron: 1, crafting_table: 1, oak_planks: 10, stone_pickaxe: 1 };
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
      blocks: { oak_log: { count: 10, closestDistance: 5, averageDistance: 10 } },
      entities: {}
    };
    const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });
    // Iterate directly without Array.from() - just get first path
    let path: any = null;
    for (const p of enumerateShortestPathsGenerator(tree, { inventory })) {
      path = p;
      break;
    }
    expect(path).toBeDefined();
    const found = path.find((s: any) => s.action === 'smelt' && s.result?.variants[0].value.item === 'iron_ingot');
    expect(found).toBeTruthy();
    // Smoke build of state machine (no runtime execution here)
    const fakeBot = {} as any;
    const sm = buildStateMachineForPath(fakeBot, [found], () => {});
    expect(sm).toBeTruthy();
  });
});

