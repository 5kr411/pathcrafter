import analyzeRecipes from '../../recipeAnalyzer';

describe('integration: workstation inventory shortcut', () => {
  const { resolveMcData, enumerateShortestPathsGenerator } = (analyzeRecipes as any)._internals;
  const mcData = resolveMcData('1.20.1');

  test('does not re-craft crafting_table when already in inventory', () => {
    const inventory = { crafting_table: 1, stick: 2, oak_planks: 10, stone_pickaxe: 1 };
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
      blocks: { oak_log: { count: 20, closestDistance: 5, averageDistance: 10 } },
      entities: {}
    };
    const tree = analyzeRecipes(mcData, 'iron_pickaxe', 1, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });

    let foundInvalid = false;
    let checked = 0;
    for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
      if (path.some((s: any) => s.action === 'craft' && s.result?.variants?.[0]?.value?.item === 'crafting_table')) {
        foundInvalid = true;
        break;
      }
      if (++checked >= 15) break;
    }

    expect(foundInvalid).toBe(false);
  });
});


