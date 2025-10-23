import plan from '../../planner';

describe('integration: world pruning with only acacia wood available (wooden_pickaxe)', () => {
  const { resolveMcData, enumerateShortestPathsGenerator } = (plan as any)._internals;
  const mcData = resolveMcData('1.20.1');

  function hasWoodenPickCraft(path: any[]): boolean {
    return path.some((s: any) => {
      if (s.action !== 'craft') return false;
      const r = s.result;
      const rv = s.resultVariants;
      if (r && r.item === 'wooden_pickaxe') return true;
      if (r && r.variants && r.variants.some((v: any) => (v.value?.item || v.value) === 'wooden_pickaxe')) return true;
      if (rv && rv.some((v: any) => (v.value?.item || v.value) === 'wooden_pickaxe')) return true;
      return false;
    });
  }

  test('generates a valid path and crafts wooden_pickaxe when only acacia exists', () => {
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 2,
      radius: 32,
      yMin: 0,
      yMax: 255,
      blocks: {
        // Only acacia logs available nearby; no oak present
        acacia_log: { count: 120, closestDistance: 6, averageDistance: 12 }
      },
      entities: {}
    };

    const inventory = new Map<string, number>();

    const tree = plan(mcData, 'wooden_pickaxe', 1, {
      log: false,
      inventory,
      combineSimilarNodes: true,
      pruneWithWorld: true,
      worldSnapshot
    });

    const paths: any[] = [];
    const gen = enumerateShortestPathsGenerator(tree, { inventory });
    for (let i = 0; i < 10; i++) {
      const next = gen.next();
      if (next.done) break;
      paths.push(next.value);
    }

    expect(paths.length).toBeGreaterThan(0);

    const firstPath = paths[0];
    expect(hasWoodenPickCraft(firstPath)).toBe(true);
  });
});
