import plan from '../../planner';
import { enumerateLowestWeightPathsGenerator } from '../../path_generators/lowestWeightPathsGenerator';

describe.skip('integration: world pruning respects block->drop mapping', () => {
  const ctx = '1.20.1';

  test('coal target considers coal_ore availability', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const snap = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { coal_ore: { count: 3, closestDistance: 8, averageDistance: 10 } }, entities: {} };
    const tree = plan(ctx, 'coal', 2, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snap });
    const paths = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory }));
    const hasMining = paths.some(seq => seq.some((s: any) => s.action === 'mine' && (s.targetItem === 'coal' || s.what === 'coal_ore')));
    expect(hasMining).toBe(true);
  });

  test('raw_iron target considers iron_ore availability', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const snap = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { iron_ore: { count: 4, closestDistance: 10, averageDistance: 12 }, deepslate_iron_ore: { count: 2, closestDistance: 12, averageDistance: 15 } }, entities: {} };
    const tree = plan(ctx, 'raw_iron', 3, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snap });
    const paths = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory }));
    const hasMining = paths.some(seq => seq.some((s: any) => s.action === 'mine' && (s.targetItem === 'raw_iron' || s.what === 'iron_ore' || s.what === 'deepslate_iron_ore')));
    expect(hasMining).toBe(true);
  });

  test('prunes when snapshot lacks matching source blocks for target drop', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const snap = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { }, entities: {} };
    const tree = plan(ctx, 'coal', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snap });
    const paths = Array.from(enumerateLowestWeightPathsGenerator(tree, { inventory }));
    const hasMining = paths.some(seq => seq.some((s: any) => s.action === 'mine' && (s.targetItem === 'coal' || s.what === 'coal_ore')));
    expect(hasMining).toBe(false);
  });
});

