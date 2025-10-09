import plan from '../../planner';
import { enumerateActionPathsGenerator } from '../../path_generators/actionPathsGenerator';

describe.skip('unit: planner world-pruning (generic wood disabled)', () => {
  const ctx = '1.20.1';

  test('insufficient ore count prunes mining paths', () => {
    const inventory = new Map([['stone_pickaxe', 1]]);
    const worldSnapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
      blocks: { iron_ore: { count: 0, closestDistance: null, averageDistance: 0 } }, entities: {}
    };
    const tree = plan(ctx, 'raw_iron', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot });
    const paths = Array.from(enumerateActionPathsGenerator(tree, { inventory }));
    // Without iron_ore available, expect paths that smelt or other sources only; no mine iron_ore
    const hasMineIronOre = paths.some(seq => seq.some(s => s.action === 'mine' && s.what.variants[0].value === 'iron_ore'));
    expect(hasMineIronOre).toBe(false);
  });

  test('limited ore count allows only requested quantity', () => {
    const inventory = new Map([['stone_pickaxe', 1]]);
    const worldSnapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255,
      blocks: { iron_ore: { count: 1, closestDistance: 10, averageDistance: 10 } }, entities: {}
    };
    const tree = plan(ctx, 'raw_iron', 2, { log: false, inventory, pruneWithWorld: true, worldSnapshot });
    const paths = Array.from(enumerateActionPathsGenerator(tree, { inventory }));
    // With only 1 iron_ore, producing 2 raw_iron from pure mining should be pruned
    const hasMineTwoIron = paths.some(seq => {
      const mines = seq.filter(s => s.action === 'mine' && s.what.variants[0].value === 'iron_ore');
      const total = mines.reduce((a, s) => a + (s.count || 0), 0);
      return total >= 2;
    });
    expect(hasMineTwoIron).toBe(false);
  });
});

