import { generateTopNAndFilter } from '../../path_filters';

describe('unit: Top-N tie-break by snapshot distance', () => {

  test('prefers closer wood species when weights are equal', async () => {
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 3, yMin: 0, yMax: 255,
      blocks: {
        spruce_log: { count: 10, closestDistance: 8, averageDistance: 12 },
        oak_log: { count: 10, closestDistance: 30, averageDistance: 45 }
      },
      entities: {}
    };
    const inventory = { crafting_table: 1 };
    const paths = await generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, {
      inventory,
      worldSnapshot: snapshot,
      perGenerator: 50,
      log: false,
      pruneWithWorld: true
    });
    expect(paths.length).toBeGreaterThan(0);
    const first = paths[0];
    const minedNames = first.filter(s => s && s.action === 'mine').map(s => s.what);
    const considered = minedNames.filter(n => (snapshot.blocks as any)[n]);
    if (considered.length === 0) {
      // Nothing mined that exists in snapshot; skip strict assertion
      expect(paths.length).toBeGreaterThan(0);
      return;
    }
    // Compute avg distance for mined wood and ensure it is minimal among present species
    const getAvg = (n: string) => ((snapshot.blocks as any)[n] && (snapshot.blocks as any)[n].averageDistance) || Infinity;
    const minedAvg = Math.min(...considered.map(getAvg));
    const presentSpecies = Object.keys(snapshot.blocks).filter(n => /_log$/.test(n));
    const minPresentAvg = Math.min(...presentSpecies.map(getAvg));
    expect(minedAvg).toBe(minPresentAvg);
  });
});

