import plan from '../../planner';

describe('integration: world pruning respects block->drop mapping', () => {
  const ctx = '1.20.1';

  test('coal target considers coal_ore availability', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const snap = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { coal_ore: { count: 3, closestDistance: 8, averageDistance: 10 } }, entities: {} };
    const tree = plan(ctx, 'coal', 2, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snap });
    const childCount = tree.children?.variants?.length ?? 0;
    expect(childCount).toBeGreaterThan(0);
  });

  test('raw_iron target considers iron_ore availability', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const snap = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { iron_ore: { count: 4, closestDistance: 10, averageDistance: 12 }, deepslate_iron_ore: { count: 2, closestDistance: 12, averageDistance: 15 } }, entities: {} };
    const tree = plan(ctx, 'raw_iron', 3, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snap });
    const childCount = tree.children?.variants?.length ?? 0;
    expect(childCount).toBeGreaterThan(0);
  });

  test('prunes when snapshot lacks matching source blocks for target drop', () => {
    const inventory = new Map([["stone_pickaxe", 1]]);
    const snap = { version: '1.20.1', dimension: 'overworld', center: { x:0,y:64,z:0 }, chunkRadius: 1, radius: 16, yMin: 0, yMax: 255, blocks: { }, entities: {} };
    const tree = plan(ctx, 'coal', 1, { log: false, inventory, pruneWithWorld: true, worldSnapshot: snap });
    const hasMining = tree.children?.variants?.some((child: any) => child.value?.action === 'mine');
    expect(hasMining).toBe(false);
  });
});

