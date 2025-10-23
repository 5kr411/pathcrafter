import plan from '../../planner';

describe('integration: smelting injects fuel dependency', () => {
  const { resolveMcData, enumerateShortestPathsGenerator } = (plan as any)._internals;
  const mcData = resolveMcData('1.20.1');

  test('acquires coal when inventory has none for smelting iron_ingot', () => {
    const inventory = new Map([['furnace', 1], ['raw_iron', 3], ['crafting_table', 1], ['oak_planks', 10], ['stone_pickaxe', 1]]);
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 2, radius: 32, yMin: 0, yMax: 255,
      blocks: { 
        coal_ore: { count: 10, closestDistance: 8, averageDistance: 12 },
        cobblestone: { count: 50, closestDistance: 3, averageDistance: 8 }
      },
      entities: {}
    };
    const tree = plan(mcData, 'iron_ingot', 3, { log: false, inventory, worldSnapshot: snapshot, pruneWithWorld: true });

    let foundFuelAcquisition = false;
    let checked = 0;
    for (const path of enumerateShortestPathsGenerator(tree, { inventory })) {
      const hasSmelt = path.some((s: any) => s.action === 'smelt' && s.result?.variants?.[0]?.value?.item === 'iron_ingot');
      const acquiresCoal = path.some((s: any) => s.action === 'mine' && (s.targetItem?.variants?.some((v: any) => v.value === 'coal') || s.what?.variants?.some((v: any) => v.value === 'coal_ore')));
      if (hasSmelt && acquiresCoal) { foundFuelAcquisition = true; break; }
      if (++checked >= 15) break;
    }

    expect(foundFuelAcquisition).toBe(true);
  });
});


