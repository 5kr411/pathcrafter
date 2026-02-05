import {
  buildResourceStats,
  collectBlockAggregates,
  collectEntityStats,
  dist,
  updateAggregation
} from '../../utils/worldSnapshotHelpers';

function makePos(x: number, y: number, z: number) {
  return { x, y, z };
}

describe('worldSnapshotHelpers', () => {
  it('dist calculates Euclidean distance', () => {
    expect(dist(0, 0, 0, 3, 4, 0)).toBe(5);
  });

  it('updateAggregation and buildResourceStats aggregate counts and distances', () => {
    const agg = new Map();
    updateAggregation(agg, 'stone', 2);
    updateAggregation(agg, 'stone', 5);
    updateAggregation(agg, 'dirt', Math.sqrt(2));

    const stats = buildResourceStats(agg);
    expect(stats.stone.count).toBe(2);
    expect(stats.stone.closestDistance).toBe(2);
    expect(stats.stone.averageDistance).toBe(3.5);
    expect(stats.dirt.count).toBe(1);
    expect(stats.dirt.closestDistance).toBeCloseTo(Math.sqrt(2), 5);
  });

  it('collectBlockAggregates skips air and respects radius', () => {
    const blocks = new Map<string, string>([
      ['3,0,4', 'stone'],
      ['0,0,2', 'stone'],
      ['1,0,1', 'dirt'],
      ['10,0,0', 'stone'],
      ['2,0,0', 'air']
    ]);

    const bot = {
      blockAt: (pos: any) => ({ name: blocks.get(`${pos.x},${pos.y},${pos.z}`) })
    };

    const positions = [
      makePos(3, 0, 4),
      makePos(0, 0, 2),
      makePos(1, 0, 1),
      makePos(10, 0, 0),
      makePos(2, 0, 0)
    ];

    const agg = collectBlockAggregates({
      bot: bot as any,
      positions,
      includeAir: false,
      center: { x: 0, y: 0, z: 0 },
      maxRadius: 6
    });

    const stats = buildResourceStats(agg);
    expect(stats.stone.count).toBe(2);
    expect(stats.dirt.count).toBe(1);
    expect(stats.stone.closestDistance).toBe(2);
    expect(stats.stone.averageDistance).toBe(3.5);
    expect(stats.air).toBeUndefined();
  });

  it('collectEntityStats aggregates entity distances', () => {
    const bot = {
      entities: {
        a: { name: 'cow', position: makePos(0, 0, 3) },
        b: { type: 'zombie', position: makePos(4, 0, 0) }
      }
    };

    const stats = collectEntityStats(bot as any, { x: 0, y: 0, z: 0 });
    expect(stats.cow.count).toBe(1);
    expect(stats.cow.closestDistance).toBe(3);
    expect(stats.zombie.count).toBe(1);
    expect(stats.zombie.closestDistance).toBe(4);
  });
});
