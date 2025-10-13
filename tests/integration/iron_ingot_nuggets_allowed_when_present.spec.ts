import analyzeRecipes from '../../recipeAnalyzer';

describe('integration: gold nugget -> gold ingot allowed when nuggets present', () => {
  const { resolveMcData } = (analyzeRecipes as any)._internals;
  const mcData = resolveMcData('1.20.1');

  test('path includes gold nugget -> gold ingot craft when inventory has 9 nuggets (inventory-gated)', () => {
    const inventory = { gold_nugget: 9, crafting_table: 1 };
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
      blocks: {},
      entities: {}
    };
    const tree = analyzeRecipes(mcData, 'gold_ingot', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });

    const { enumerateLowestWeightPathsGenerator } = (analyzeRecipes as any)._internals;
    let found = false;
    let checked = 0;
    for (const path of enumerateLowestWeightPathsGenerator(tree, { inventory })) {
      if (path.some((s: any) => s.action === 'craft' && s.result?.variants?.[0]?.value?.item === 'gold_ingot' && (s.ingredients?.variants?.[0]?.value || []).some((i: any) => i.item === 'gold_nugget'))) {
        found = true;
        break;
      }
      if (++checked >= 20) break;
    }

    expect(found).toBe(true);
  });
});


