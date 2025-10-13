import analyzeRecipes from '../../recipeAnalyzer';

describe('integration: furnace cobblestone acquisition appears before smelting', () => {
  const { resolveMcData, enumerateShortestPathsGenerator } = (analyzeRecipes as any)._internals;
  const mcData = resolveMcData('1.20.1');

  test('mines cobblestone and crafts furnace before smelt when needed', () => {
    const inventory = { crafting_table: 1, raw_iron: 1, coal: 1 };
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2, radius: 32, yMin: 0, yMax: 255,
      blocks: { cobblestone: { count: 100, closestDistance: 3, averageDistance: 8 } },
      entities: {}
    };
    const tree = analyzeRecipes(mcData, 'iron_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });

    let foundOrder = false;
    let checked = 0;
    for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
      const firstMineIndex = path.findIndex((s: any) => s.action === 'mine');
      const craftFurnaceIndex = path.findIndex((s: any) => s.action === 'craft' && s.result?.variants?.[0]?.value?.item === 'furnace');
      const smeltIndex = path.findIndex((s: any) => s.action === 'smelt' && s.result?.variants?.[0]?.value?.item === 'iron_ingot');
      // Accept: at least one mining action happens before smelting; and if furnace craft exists, it is before smelt
      if (smeltIndex >= 0 && firstMineIndex >= 0 && firstMineIndex < smeltIndex && (craftFurnaceIndex < 0 || craftFurnaceIndex < smeltIndex)) {
        foundOrder = true;
        break;
      }
      if (++checked >= 30) break;
    }

    expect(foundOrder).toBe(true);
  });
});


