import plan from '../../planner';
import { enumerateLowestWeightPathsGenerator } from '../../path_generators/lowestWeightPathsGenerator';

describe('integration: world-pruning planning (generic wood disabled)', () => {
  const ctx = '1.20.1';

  test('prunes mining source when world has no coal_ore', () => {
    const inventory = { stone_pickaxe: 1 };
    const noCoal = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { }, entities: {} };
    const treePruned = plan(ctx, 'coal', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot: noCoal });
    const lwPruned = Array.from(enumerateLowestWeightPathsGenerator(treePruned, { inventory }));
    // With no coal_ore in world, there should be no mining route for 'coal'
    const hasMiningCoal = lwPruned.some(seq => seq.some((s: any) => s.action === 'mine' && (s.targetItem === 'coal' || s.what === 'coal_ore')));
    expect(hasMiningCoal).toBe(false);
  });

  test('allows mining when world has enough coal_ore', () => {
    const inventory = { stone_pickaxe: 1 };
    // Ensure enough to cover expected yields; coal drops 1 per ore
    const hasCoal = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { coal_ore: { count: 5, closestDistance: 10, averageDistance: 12 } }, entities: {} };
    const treeOk = plan(ctx, 'coal', 2, { log: false, inventory, pruneWithWorld: true, worldSnapshot: hasCoal });
    const lwOk = Array.from(enumerateLowestWeightPathsGenerator(treeOk, { inventory }));
    const hasMiningCoal = lwOk.some(seq => seq.some((s: any) => s.action === 'mine' && (s.targetItem?.variants[0].value === 'coal' || s.what.variants[0].value === 'coal_ore')));
    expect(hasMiningCoal).toBe(true);
  });
});

