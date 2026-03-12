import createSafeFindBlock from '../../behaviors/behaviorSafeFindBlock';
import { Vec3 } from 'vec3';

function makeBot(position: Vec3, blocks: Map<string, any> = new Map()) {
  return {
    version: '1.21.1',
    entity: { position },
    blockAt(pos: Vec3) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      return blocks.get(key) || { type: 1, name: 'stone', position: pos };
    },
    canDigBlock() { return true; },
    canSeeBlock() { return true; },
    findBlocks() { return []; },
  } as any;
}

describe('BehaviorSafeFindBlock candidate rotation', () => {
  it('hasMoreCandidates returns false when no scan has run', () => {
    const targets: any = {};
    const finder = createSafeFindBlock(makeBot(new Vec3(0, 64, 0)), targets);
    expect(finder.hasMoreCandidates()).toBe(false);
  });

  it('tryNextCandidate returns false when no candidates remain', () => {
    const targets: any = {};
    const finder = createSafeFindBlock(makeBot(new Vec3(0, 64, 0)), targets);
    expect(finder.tryNextCandidate()).toBe(false);
  });

  it('onStateEntered rotates to next candidate instead of rescanning when candidates remain', () => {
    const targets: any = {};
    const bot = makeBot(new Vec3(0, 64, 0));
    const finder = createSafeFindBlock(bot, targets);

    // Simulate a scan that produced multiple candidates
    (finder as any)._candidateList = [new Vec3(1, 64, 0), new Vec3(2, 64, 0), new Vec3(3, 64, 0)];
    (finder as any)._candidateIndex = 1; // first was already popped

    expect(finder.hasMoreCandidates()).toBe(true);

    finder.onStateEntered();

    // Should have popped candidate at index 1 (Vec3(2, 64, 0))
    expect(targets.position).toEqual(new Vec3(2, 64, 0));
    // Should be synchronously finished (no async scan)
    expect(finder.isFinished()).toBe(true);
  });

  it('rotates through all candidates then reports exhausted', () => {
    const targets: any = {};
    const bot = makeBot(new Vec3(0, 64, 0));
    const finder = createSafeFindBlock(bot, targets);

    const candidates = [new Vec3(1, 64, 0), new Vec3(2, 64, 0), new Vec3(3, 64, 0)];
    (finder as any)._candidateList = candidates;
    (finder as any)._candidateIndex = 0;

    // Pop all 3
    expect(finder.tryNextCandidate()).toBe(true);
    expect(targets.position).toEqual(new Vec3(1, 64, 0));

    expect(finder.tryNextCandidate()).toBe(true);
    expect(targets.position).toEqual(new Vec3(2, 64, 0));

    expect(finder.tryNextCandidate()).toBe(true);
    expect(targets.position).toEqual(new Vec3(3, 64, 0));

    expect(finder.tryNextCandidate()).toBe(false);
    expect(finder.hasMoreCandidates()).toBe(false);
  });

  describe('matchesBlock cave_vines filtering', () => {
    function makeBlock(name: string, type: number, properties: Record<string, any> = {}) {
      return {
        name,
        type,
        getProperties() { return properties; },
      } as any;
    }

    it('rejects cave_vines without berries', () => {
      const targets: any = {};
      const finder = createSafeFindBlock(makeBot(new Vec3(0, 64, 0)), targets);
      finder.blocks = [100];
      const block = makeBlock('cave_vines', 100, { berries: false });
      expect(finder.matchesBlock(block)).toBe(false);
    });

    it('accepts cave_vines with berries=true', () => {
      const targets: any = {};
      const finder = createSafeFindBlock(makeBot(new Vec3(0, 64, 0)), targets);
      finder.blocks = [100];
      const block = makeBlock('cave_vines', 100, { berries: true });
      expect(finder.matchesBlock(block)).toBe(true);
    });

    it('rejects cave_vines_plant without berries', () => {
      const targets: any = {};
      const finder = createSafeFindBlock(makeBot(new Vec3(0, 64, 0)), targets);
      finder.blocks = [101];
      const block = makeBlock('cave_vines_plant', 101, { berries: false });
      expect(finder.matchesBlock(block)).toBe(false);
    });

    it('accepts cave_vines_plant with berries=true', () => {
      const targets: any = {};
      const finder = createSafeFindBlock(makeBot(new Vec3(0, 64, 0)), targets);
      finder.blocks = [101];
      const block = makeBlock('cave_vines_plant', 101, { berries: true });
      expect(finder.matchesBlock(block)).toBe(true);
    });

    it('accepts non-cave-vines blocks without berries check', () => {
      const targets: any = {};
      const finder = createSafeFindBlock(makeBot(new Vec3(0, 64, 0)), targets);
      finder.blocks = [1];
      const block = makeBlock('stone', 1, {});
      expect(finder.matchesBlock(block)).toBe(true);
    });
  });

  it('onStateEntered does fresh scan when no candidates remain', () => {
    const targets: any = {};
    const bot = makeBot(new Vec3(0, 64, 0));
    const finder = createSafeFindBlock(bot, targets);

    // Empty candidate list
    (finder as any)._candidateList = [];
    (finder as any)._candidateIndex = 0;

    finder.onStateEntered();

    // Should be in scanning state (async scan kicked off)
    expect((finder as any)._scanning).toBe(true);
  });
});
