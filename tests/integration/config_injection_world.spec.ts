import plan from '../../planner';

describe('integration: config injection with world pruning', () => {
  const ctx = '1.20.1';

  test('generic disabled via context forces species branches even if logs present', () => {
    const mc = (plan as any)._internals.resolveMcData(ctx);
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 3, radius: 48, yMin: 0, yMax: 255,
      blocks: { oak_log: { count: 10, closestDistance: 5, averageDistance: 12 } }, entities: {}
    };
    const tree = plan(mc, 'oak_planks', 2, { log: false, inventory: new Map(), pruneWithWorld: true, worldSnapshot: snapshot });
    // Walk tree to find ingredient selection node if present
    const craftNode = (tree.children?.variants || []).find((ch: any) => ch.value && ch.value.action === 'craft')?.value;
    expect(!!craftNode).toBe(true);
    const ing = (craftNode as any).ingredients?.variants || [];
    const anyGeneric = ing.some((i: any) => i && i.meta && i.meta.generic === true);
    expect(anyGeneric).toBe(false);
  });
});

