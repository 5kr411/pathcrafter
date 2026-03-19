import { beginSnapshotScan, stepSnapshotScan, snapshotFromState } from '../../utils/worldSnapshot';
import { captureAdaptiveSnapshot } from '../../utils/adaptiveSnapshot';
import { Vec3 } from 'vec3';

function createMockBot(blocks: Map<string, string>) {
  return {
    version: '1.20.1',
    entity: {
      position: { x: 0, y: 64, z: 0, floored: () => ({ x: 0, y: 64, z: 0 }) }
    },
    blockAt: (pos: Vec3) => {
      const key = `${pos.x},${pos.y},${pos.z}`;
      const name = blocks.get(key) || 'stone';
      return { name };
    }
  } as any;
}

describe('ring scanning (innerRadius)', () => {
  it('full scan captures blocks at all distances', async () => {
    const blocks = new Map<string, string>();
    // Block at distance 5 (dx=5, dy=0, dz=0)
    blocks.set('5,64,0', 'iron_ore');
    // Block at distance 20 (dx=20, dy=0, dz=0)
    blocks.set('20,64,0', 'diamond_ore');

    const bot = createMockBot(blocks);
    const scan = beginSnapshotScan(bot, { radius: 25, yMin: 63, yMax: 65 });
    await stepSnapshotScan(scan);
    const snap = snapshotFromState(scan);

    expect(snap.blocks['iron_ore']).toBeDefined();
    expect(snap.blocks['iron_ore'].count).toBeGreaterThanOrEqual(1);
    expect(snap.blocks['diamond_ore']).toBeDefined();
    expect(snap.blocks['diamond_ore'].count).toBeGreaterThanOrEqual(1);
  });

  it('ring scan skips blocks inside inner sphere', async () => {
    const blocks = new Map<string, string>();
    // Block at distance 5 — inside inner radius
    blocks.set('5,64,0', 'iron_ore');
    // Block at distance 20 — in the ring
    blocks.set('20,64,0', 'diamond_ore');

    const bot = createMockBot(blocks);
    const scan = beginSnapshotScan(bot, { radius: 25, innerRadius: 10, yMin: 63, yMax: 65 });
    await stepSnapshotScan(scan);
    const snap = snapshotFromState(scan);

    // iron_ore at distance 5 should be skipped (within innerRadius=10)
    expect(snap.blocks['iron_ore']).toBeUndefined();
    // diamond_ore at distance 20 should be found
    expect(snap.blocks['diamond_ore']).toBeDefined();
    expect(snap.blocks['diamond_ore'].count).toBeGreaterThanOrEqual(1);
  });

  it('innerRadius 0 behaves like normal full scan', async () => {
    const blocks = new Map<string, string>();
    blocks.set('5,64,0', 'iron_ore');
    blocks.set('20,64,0', 'diamond_ore');

    const bot = createMockBot(blocks);
    const scan = beginSnapshotScan(bot, { radius: 25, innerRadius: 0, yMin: 63, yMax: 65 });
    await stepSnapshotScan(scan);
    const snap = snapshotFromState(scan);

    expect(snap.blocks['iron_ore']).toBeDefined();
    expect(snap.blocks['diamond_ore']).toBeDefined();
  });

  it('pre-seeded blockAgg is preserved and extended', async () => {
    const blocks = new Map<string, string>();
    // diamond_ore in the ring (distance 20)
    blocks.set('20,64,0', 'diamond_ore');

    const bot = createMockBot(blocks);
    const scan = beginSnapshotScan(bot, { radius: 25, innerRadius: 10, yMin: 63, yMax: 65 });

    // Pre-seed with iron_ore data (as if from a previous scan)
    scan.blockAgg.set('iron_ore', { count: 3, sumDist: 15, closest: 4 });

    await stepSnapshotScan(scan);
    const snap = snapshotFromState(scan);

    // Pre-seeded iron_ore should still be present
    expect(snap.blocks['iron_ore']).toBeDefined();
    expect(snap.blocks['iron_ore'].count).toBe(3);
    // diamond_ore from the ring should also be present
    expect(snap.blocks['diamond_ore']).toBeDefined();
    expect(snap.blocks['diamond_ore'].count).toBeGreaterThanOrEqual(1);
  });
});

describe('adaptive snapshot with ring reuse', () => {
  it('does not re-scan inner positions when expanding radius', async () => {
    const scannedPositions: string[] = [];

    const bot = {
      version: '1.20.1',
      entity: {
        position: { x: 0, y: 64, z: 0, floored: () => ({ x: 0, y: 64, z: 0 }) }
      },
      game: { dimension: 'overworld' },
      blockAt: (pos: any) => {
        scannedPositions.push(`${pos.x},${pos.y},${pos.z}`);
        return { name: 'stone' };
      },
      entities: {}
    } as any;

    await captureAdaptiveSnapshot(bot, {
      radii: [8, 16],
      yMin: 63,
      yMax: 65,
      validator: async (snap: any) => snap.radius >= 16
    });

    // Count how many times position (5, 64, 0) was scanned — it's at distance 5,
    // inside both r=8 and r=16 spheres. With ring scanning, it should only be scanned once.
    const target = '5,64,0';
    const hitCount = scannedPositions.filter(p => p === target).length;
    expect(hitCount).toBe(1);
  });
});
