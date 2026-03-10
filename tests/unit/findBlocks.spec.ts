import { findBlocksNonBlocking } from '../../utils/findBlocks';
import { Vec3 } from 'vec3';

describe('findBlocksNonBlocking', () => {
  function makeBot(blocks: Map<string, { type: number; name: string }>) {
    return {
      entity: { position: new Vec3(0, 64, 0) },
      version: '1.21.1',
      blockAt: (pos: Vec3) => {
        const key = `${pos.x},${pos.y},${pos.z}`;
        return blocks.get(key) || { type: 0, name: 'air' };
      }
    };
  }

  it('finds blocks matching a numeric ID within radius', async () => {
    const blocks = new Map<string, { type: number; name: string }>();
    blocks.set('3,64,0', { type: 4, name: 'cobblestone' });
    blocks.set('1,64,0', { type: 4, name: 'cobblestone' });
    blocks.set('50,64,0', { type: 4, name: 'cobblestone' }); // outside radius

    const bot = makeBot(blocks);
    const results = await findBlocksNonBlocking(bot, {
      matching: 4,
      maxDistance: 10,
      count: 10
    });

    expect(results.length).toBe(2);
    // nearest first
    expect(results[0].x).toBe(1);
    expect(results[1].x).toBe(3);
  });

  it('finds blocks matching an array of IDs', async () => {
    const blocks = new Map<string, { type: number; name: string }>();
    blocks.set('2,64,0', { type: 4, name: 'cobblestone' });
    blocks.set('3,64,0', { type: 1, name: 'stone' });

    const bot = makeBot(blocks);
    const results = await findBlocksNonBlocking(bot, {
      matching: [1, 4],
      maxDistance: 10,
      count: 10
    });

    expect(results.length).toBe(2);
  });

  it('finds blocks matching a predicate function', async () => {
    const blocks = new Map<string, { type: number; name: string }>();
    blocks.set('2,64,0', { type: 4, name: 'cobblestone' });
    blocks.set('3,64,0', { type: 1, name: 'stone' });

    const bot = makeBot(blocks);
    const results = await findBlocksNonBlocking(bot, {
      matching: (block: any) => block.name === 'stone',
      maxDistance: 10,
      count: 10
    });

    expect(results.length).toBe(1);
    expect(results[0].x).toBe(3);
  });

  it('respects count limit', async () => {
    const blocks = new Map<string, { type: number; name: string }>();
    for (let x = 1; x <= 5; x++) {
      blocks.set(`${x},64,0`, { type: 4, name: 'cobblestone' });
    }

    const bot = makeBot(blocks);
    const results = await findBlocksNonBlocking(bot, {
      matching: 4,
      maxDistance: 10,
      count: 2
    });

    expect(results.length).toBe(2);
    // nearest first
    expect(results[0].x).toBe(1);
    expect(results[1].x).toBe(2);
  });

  it('returns empty array when no matches', async () => {
    const bot = makeBot(new Map());
    const results = await findBlocksNonBlocking(bot, {
      matching: 4,
      maxDistance: 10,
      count: 10
    });

    expect(results).toEqual([]);
  });

  it('returns results sorted nearest-first', async () => {
    const blocks = new Map<string, { type: number; name: string }>();
    blocks.set('5,64,0', { type: 4, name: 'cobblestone' });
    blocks.set('1,64,0', { type: 4, name: 'cobblestone' });
    blocks.set('3,64,0', { type: 4, name: 'cobblestone' });

    const bot = makeBot(blocks);
    const results = await findBlocksNonBlocking(bot, {
      matching: 4,
      maxDistance: 10,
      count: 10
    });

    const distances = results.map(r => r.x);
    expect(distances).toEqual([1, 3, 5]);
  });
});
