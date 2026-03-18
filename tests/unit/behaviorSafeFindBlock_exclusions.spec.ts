import createSafeFindBlock from '../../behaviors/behaviorSafeFindBlock';

// Minimal bot/targets stubs
function makeBot(blocks: Map<string, any> = new Map()) {
  return {
    findBlocks: () => [],
    canSeeBlock: () => true,
    blockAt: (pos: any) => blocks.get(`${pos.x},${pos.y},${pos.z}`) ?? null,
    canDigBlock: (b: any) => b && b.name !== 'air',
    version: '1.21.1',
    entity: { position: { x: 0, y: 64, z: 0, distanceTo: (o: any) => Math.sqrt((o.x)**2 + (o.y-64)**2 + (o.z)**2) } },
  };
}

function makeTargets() {
  return { position: undefined } as any;
}

function vec3(x: number, y: number, z: number) {
  return { x, y, z, distanceTo: (o: any) => Math.sqrt((x-o.x)**2 + (y-o.y)**2 + (z-o.z)**2) };
}

describe('BehaviorSafeFindBlock exclusion splitting', () => {
  it('addExcludedPosition marks position as path-excluded', () => {
    const fb = createSafeFindBlock(makeBot() as any, makeTargets());
    const pos = vec3(10, 5, 10);
    fb.addExcludedPosition(pos as any);
    expect(fb.isExcluded(pos as any)).toBe(true);
  });

  it('addAirExcludedPosition marks position as air-excluded', () => {
    const fb = createSafeFindBlock(makeBot() as any, makeTargets());
    const pos = vec3(10, 5, 10);
    fb.addAirExcludedPosition(pos as any);
    expect(fb.isExcluded(pos as any)).toBe(true);
  });

  it('clearExclusions clears path exclusions but NOT air exclusions', () => {
    const fb = createSafeFindBlock(makeBot() as any, makeTargets());
    const airPos = vec3(10, 5, 10);
    const pathPos = vec3(20, 5, 20);

    fb.addAirExcludedPosition(airPos as any);
    fb.addExcludedPosition(pathPos as any);

    expect(fb.isExcluded(airPos as any)).toBe(true);
    expect(fb.isExcluded(pathPos as any)).toBe(true);

    fb.clearExclusions();

    // Air exclusion survives
    expect(fb.isExcluded(airPos as any)).toBe(true);
    // Path exclusion cleared
    expect(fb.isExcluded(pathPos as any)).toBe(false);
  });

  it('clearAllExclusions clears both air and path exclusions', () => {
    const fb = createSafeFindBlock(makeBot() as any, makeTargets());
    const airPos = vec3(10, 5, 10);
    const pathPos = vec3(20, 5, 20);

    fb.addAirExcludedPosition(airPos as any);
    fb.addExcludedPosition(pathPos as any);

    fb.clearAllExclusions();

    expect(fb.isExcluded(airPos as any)).toBe(false);
    expect(fb.isExcluded(pathPos as any)).toBe(false);
  });

  describe('tryNextCandidate air filtering', () => {
    it('skips candidates that are now air', () => {
      const airAt = new Set<string>();
      const bot = {
        ...makeBot(),
        blockAt: (pos: any) => {
          const key = `${pos.x},${pos.y},${pos.z}`;
          if (airAt.has(key)) return { type: 0, name: 'air' };
          return { type: 16, name: 'coal_ore' };
        },
      };
      const targets = makeTargets();
      const fb = createSafeFindBlock(bot as any, targets);

      // Manually inject candidate list: [airBlock, validBlock]
      const airPos = vec3(10, 5, 10);
      const validPos = vec3(20, 5, 20);
      airAt.add('10,5,10');

      (fb as any)._candidateList = [airPos, validPos];
      (fb as any)._candidateIndex = 0;

      const result = fb.tryNextCandidate();
      expect(result).toBe(true);
      // Should have skipped airPos and returned validPos
      expect(targets.position).toEqual(validPos);
    });

    it('returns false when all remaining candidates are air', () => {
      const bot = {
        ...makeBot(),
        blockAt: () => ({ type: 0, name: 'air' }),
      };
      const targets = makeTargets();
      const fb = createSafeFindBlock(bot as any, targets);

      (fb as any)._candidateList = [vec3(10, 5, 10), vec3(20, 5, 20)];
      (fb as any)._candidateIndex = 0;

      const result = fb.tryNextCandidate();
      expect(result).toBe(false);
      expect(targets.position).toBeUndefined();
    });
  });

  describe('tryNextCandidate after addAirExcludedPosition', () => {
    it('skips air-excluded positions via the exclusion list', () => {
      const bot = {
        ...makeBot(),
        // All blocks appear solid — exclusion must come from the exclusion list, not blockAt
        blockAt: () => ({ type: 16, name: 'coal_ore' }),
      };
      const targets = makeTargets();
      const fb = createSafeFindBlock(bot as any, targets);

      const excludedPos = vec3(10, 5, 10);
      const validPos = vec3(20, 5, 20);

      // Air-exclude the first position before calling tryNextCandidate
      fb.addAirExcludedPosition(excludedPos as any);

      (fb as any)._candidateList = [excludedPos, validPos];
      (fb as any)._candidateIndex = 0;

      const result = fb.tryNextCandidate();
      expect(result).toBe(true);
      expect(targets.position).toEqual(validPos);
    });

    it('returns false when all candidates were air-excluded', () => {
      const bot = {
        ...makeBot(),
        blockAt: () => ({ type: 16, name: 'coal_ore' }),
      };
      const targets = makeTargets();
      const fb = createSafeFindBlock(bot as any, targets);

      const pos1 = vec3(10, 5, 10);
      const pos2 = vec3(20, 5, 20);

      fb.addAirExcludedPosition(pos1 as any);
      fb.addAirExcludedPosition(pos2 as any);

      (fb as any)._candidateList = [pos1, pos2];
      (fb as any)._candidateIndex = 0;

      const result = fb.tryNextCandidate();
      expect(result).toBe(false);
      expect(targets.position).toBeUndefined();
    });
  });

  it('return-count threshold still auto-excludes into path set', () => {
    const fb = createSafeFindBlock(makeBot() as any, makeTargets());
    const pos = vec3(10, 5, 10);

    // Simulate 3 returns (default threshold)
    (fb as any)._recordReturn(pos);
    (fb as any)._recordReturn(pos);
    (fb as any)._recordReturn(pos);

    expect(fb.isExcluded(pos as any)).toBe(true);

    // Clearing path exclusions should clear return-count exclusions
    fb.clearExclusions();
    expect(fb.isExcluded(pos as any)).toBe(false);
  });
});
