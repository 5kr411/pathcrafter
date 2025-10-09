import plan from '../../planner';
import { enumerateLowestWeightPathsGenerator } from '../../path_generators/lowestWeightPathsGenerator';

describe('integration: world-pruning planning (generic wood disabled)', () => {
  const ctx = '1.20.1';

  test('prunes mining source when world has no coal_ore', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const noCoal = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { }, entities: {} };
    const treePruned = plan(ctx, 'coal', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot: noCoal });
    const gen = enumerateLowestWeightPathsGenerator(treePruned, { inventory });
    let hasMiningCoal = false;
    let count = 0;
    for (const seq of gen) {
      if (seq.some((s: any) => s.action === 'mine' && (s.targetItem === 'coal' || s.what === 'coal_ore'))) {
        hasMiningCoal = true;
        break;
      }
      if (++count >= 30) break;
    }
    expect(hasMiningCoal).toBe(false);
  });

  test('allows mining when world has enough coal_ore', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const hasCoal = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { coal_ore: { count: 5, closestDistance: 10, averageDistance: 12 } }, entities: {} };
    const treeOk = plan(ctx, 'coal', 2, { log: false, inventory, pruneWithWorld: true, worldSnapshot: hasCoal });
    const childActions = Array.isArray(treeOk.children?.variants)
      ? treeOk.children.variants.map((child: any) => child.value?.action)
      : [];
    expect(childActions).toContain('mine');
    const mineNode = (treeOk.children?.variants ?? []).find((child: any) => child.value?.action === 'mine')?.value;
    expect(mineNode?.children?.variants?.length ?? 0).toBeGreaterThan(0);
  });
});

