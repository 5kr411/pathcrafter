import createClearObstructionsState from '../../behaviors/behaviorClearObstructions';

function vec3(x: number, y: number, z: number) {
  return {
    x,
    y,
    z,
    clone: () => vec3(x, y, z),
    distanceTo: (o: any) => Math.sqrt((x - o.x) ** 2 + (y - o.y) ** 2 + (z - o.z) ** 2),
    offset(dx: number, dy: number, dz: number) {
      this.x += dx;
      this.y += dy;
      this.z += dz;
      return this;
    }
  } as any;
}

function createMockBot(position: { x: number; y: number; z: number }, blockTypes: Map<string, number>) {
  const bot: any = {
    entity: {
      position: vec3(position.x, position.y, position.z)
    },
    world: {
      getBlockType: (pos: any) => {
        const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
        return blockTypes.get(key) ?? 0;
      }
    },
    blockAt: (pos: any) => {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      const type = blockTypes.get(key) ?? 0;
      if (type === 0) return null;

      const block: any = {
        type,
        position: vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)),
        name: `block_type_${type}`
      };

      if (type === 8 || type === 9) {
        block.name = 'water';
        block.boundingBox = 'empty';
      } else if (type === 10 || type === 11) {
        block.name = 'lava';
        block.boundingBox = 'empty';
      } else {
        block.boundingBox = 'block';
      }

      return block;
    },
    canDigBlock: () => true,
    canSeeBlock: (block: any) => {
      if (!block || !block.position) return false;
      const botPos = bot.entity.position;
      const eyePos = vec3(botPos.x, botPos.y + 1.5, botPos.z);
      const dist = eyePos.distanceTo(block.position);
      return dist <= 6;
    },
    tool: {
      equipForBlock: () => Promise.resolve()
    },
    dig: () => Promise.resolve(),
    clearControlStates: () => {},
    heldItem: null
  };
  return bot;
}

async function runUntilFinished(sm: any, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    sm.update();
    await new Promise(r => setTimeout(r, 10));
    if (typeof sm.isFinished === 'function' && sm.isFinished()) break;
  }
}

describe('unit: behaviorClearObstructions', () => {
  test('no obstruction — exits with clear', async () => {
    const blockTypes = new Map<string, number>();
    blockTypes.set('3,65,0', 1); // target block only

    const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
    const targets = { blockPosition: vec3(3, 65, 0) };

    const sm = createClearObstructionsState(bot, targets);
    sm.onStateEntered();
    await runUntilFinished(sm);

    expect(sm.isFinished()).toBe(true);
    expect(sm.exitReason).toBe('clear');
  });

  test('single obstruction — clears and exits clear', async () => {
    const blockTypes = new Map<string, number>();
    blockTypes.set('2,65,0', 1); // obstruction
    blockTypes.set('4,65,0', 1); // target

    const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
    // When dig is called, remove the block from the map to simulate successful mining
    bot.dig = (block: any) => {
      const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
      blockTypes.delete(key);
      return Promise.resolve();
    };

    const targets = { blockPosition: vec3(4, 65, 0) };

    const sm = createClearObstructionsState(bot, targets);
    sm.onStateEntered();
    await runUntilFinished(sm);

    expect(sm.isFinished()).toBe(true);
    expect(sm.exitReason).toBe('clear');
  });

  test('multiple obstructions — clears iteratively', async () => {
    const blockTypes = new Map<string, number>();
    blockTypes.set('2,65,0', 1); // obstruction 1
    blockTypes.set('4,65,0', 1); // obstruction 2
    blockTypes.set('6,65,0', 1); // target

    const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
    bot.dig = (block: any) => {
      const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
      blockTypes.delete(key);
      return Promise.resolve();
    };

    const targets = { blockPosition: vec3(6, 65, 0) };

    const sm = createClearObstructionsState(bot, targets);
    sm.onStateEntered();
    await runUntilFinished(sm);

    expect(sm.isFinished()).toBe(true);
    expect(sm.exitReason).toBe('clear');
    // Both obstructions should have been removed
    expect(blockTypes.has('2,65,0')).toBe(false);
    expect(blockTypes.has('4,65,0')).toBe(false);
  });

  test('unbreakable obstruction — exits with failed', async () => {
    const blockTypes = new Map<string, number>();
    blockTypes.set('2,65,0', 1); // obstruction that never gets removed
    blockTypes.set('4,65,0', 1); // target

    const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
    // dig resolves but we never delete the block — simulating failed dig
    let digCount = 0;
    bot.dig = () => { digCount++; return Promise.resolve(); };

    const targets = { blockPosition: vec3(4, 65, 0) };

    const sm = createClearObstructionsState(bot, targets);
    sm.onStateEntered();
    await runUntilFinished(sm, 100);

    expect(sm.isFinished()).toBe(true);
    expect(sm.exitReason).toBe('failed');
    expect(digCount).toBe(3);
  });

  test('target becomes air during clearing — exits with clear', async () => {
    const blockTypes = new Map<string, number>();
    blockTypes.set('2,65,0', 1); // obstruction
    blockTypes.set('4,65,0', 1); // target

    const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
    bot.dig = (block: any) => {
      const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
      blockTypes.delete(key);
      // Also delete the target to simulate it disappearing
      blockTypes.delete('4,65,0');
      return Promise.resolve();
    };

    const targets = { blockPosition: vec3(4, 65, 0) };

    const sm = createClearObstructionsState(bot, targets);
    sm.onStateEntered();
    await runUntilFinished(sm);

    expect(sm.isFinished()).toBe(true);
    expect(sm.exitReason).toBe('clear');
  });
});
