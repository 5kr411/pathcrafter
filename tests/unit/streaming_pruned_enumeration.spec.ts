import plan from '../../planner';
import { enumerateActionPathsGenerator } from '../../path_generators/actionPathsGenerator';

describe('unit: streaming enumeration with pruned trees', () => {
  const ctx = '1.20.1';

  test('streaming produces paths for stick with world pruning', () => {
    const inventory = new Map();
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 128,
      yMin: 0,
      yMax: 255,
      blocks: {
        spruce_log: { count: 100, closestDistance: 10, averageDistance: 15 }
      },
      entities: {}
    };

    const tree = plan(ctx, 'stick', 1, {
      log: false,
      inventory,
      pruneWithWorld: true,
      worldSnapshot,
      combineSimilarNodes: true
    });

    const streamingPaths = Array.from(enumerateActionPathsGenerator(tree, { inventory, worldSnapshot }));

    expect(streamingPaths.length).toBeGreaterThan(0);
    
    const hasMinePath = streamingPaths.some(p => p.some(s => s.action === 'mine'));
    expect(hasMinePath).toBe(true);
  });

  test('streaming produces paths for wooden_pickaxe with world pruning', () => {
    const inventory = new Map();
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 128,
      yMin: 0,
      yMax: 255,
      blocks: {
        spruce_log: { count: 100, closestDistance: 10, averageDistance: 15 }
      },
      entities: {}
    };

    const tree = plan(ctx, 'wooden_pickaxe', 1, {
      log: false,
      inventory,
      pruneWithWorld: true,
      worldSnapshot,
      combineSimilarNodes: true
    });

    const streamingPaths = Array.from(enumerateActionPathsGenerator(tree, { inventory, worldSnapshot }));

    expect(streamingPaths.length).toBeGreaterThan(0);
    
    const hasMinePath = streamingPaths.some(p => p.some(s => s.action === 'mine'));
    expect(hasMinePath).toBe(true);
  });

  test('streaming produces paths for spruce_log with world pruning', () => {
    const inventory = new Map();
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 128,
      yMin: 0,
      yMax: 255,
      blocks: {
        spruce_log: { count: 100, closestDistance: 10, averageDistance: 15 }
      },
      entities: {}
    };

    const tree = plan(ctx, 'spruce_log', 1, {
      log: false,
      inventory,
      pruneWithWorld: true,
      worldSnapshot,
      combineSimilarNodes: true
    });

    const streamingPaths = Array.from(enumerateActionPathsGenerator(tree, { inventory, worldSnapshot }));

    expect(streamingPaths.length).toBeGreaterThan(0);
    
    const hasMinePath = streamingPaths.some(p => p.some(s => s.action === 'mine'));
    expect(hasMinePath).toBe(true);
  });

  test('streaming handles empty world (no resources available)', () => {
    const inventory = new Map();
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      radius: 128,
      yMin: 0,
      yMax: 255,
      blocks: {},
      entities: {}
    };

    const tree = plan(ctx, 'stick', 1, {
      log: false,
      inventory,
      pruneWithWorld: true,
      worldSnapshot,
      combineSimilarNodes: true
    });

    const streamingPaths = Array.from(enumerateActionPathsGenerator(tree, { inventory, worldSnapshot }));

    expect(streamingPaths.length).toBe(0);
  });

  test('streaming produces paths without pruning enabled', () => {
    const inventory = new Map();

    const tree = plan(ctx, 'stick', 1, {
      log: false,
      inventory,
      pruneWithWorld: false,
      combineSimilarNodes: true
    });

    const streamingPaths = Array.from(enumerateActionPathsGenerator(tree, { inventory }));

    expect(streamingPaths.length).toBeGreaterThan(0);
  });
});

