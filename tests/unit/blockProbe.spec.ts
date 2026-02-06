import {
  isWaterBlock,
  findSurfaceBlock,
  checkColumnSurface,
  probeDirectionForWater,
  randomAngle,
  offsetFromAngle
} from '../../utils/blockProbe';

describe('blockProbe', () => {
  describe('isWaterBlock', () => {
    it('returns true for water blocks', () => {
      expect(isWaterBlock({ type: 9, name: 'water' })).toBe(true);
      expect(isWaterBlock({ type: 8, name: 'flowing_water' })).toBe(true);
    });

    it('returns false for non-water blocks', () => {
      expect(isWaterBlock({ type: 1, name: 'stone' })).toBe(false);
      expect(isWaterBlock({ type: 2, name: 'dirt' })).toBe(false);
    });

    it('returns false for air or null', () => {
      expect(isWaterBlock(null)).toBe(false);
      expect(isWaterBlock({ type: 0, name: 'air' })).toBe(false);
    });
  });

  describe('findSurfaceBlock', () => {
    it('returns the first non-air block scanning downward from maxY', () => {
      const blockAt = jest.fn((pos: any) => {
        if (pos.y === 72) return { type: 2, name: 'grass_block' };
        return { type: 0, name: 'air' };
      });

      const block = findSurfaceBlock(blockAt, 10, 10, 80, 0);
      expect(block).not.toBeNull();
      expect(block.name).toBe('grass_block');
    });

    it('scans from maxY down to minY', () => {
      const queriedYs: number[] = [];
      const blockAt = jest.fn((pos: any) => {
        queriedYs.push(pos.y);
        if (pos.y === 60) return { type: 1, name: 'stone' };
        return { type: 0, name: 'air' };
      });

      findSurfaceBlock(blockAt, 0, 0, 80, 50);
      expect(queriedYs[0]).toBe(80);
      expect(queriedYs).toContain(60);
      expect(queriedYs[queriedYs.length - 1]).toBe(60);
    });

    it('returns null if blockAt returns null (unloaded chunk)', () => {
      const blockAt = jest.fn(() => null);
      const block = findSurfaceBlock(blockAt, 0, 0, 100, 0);
      expect(block).toBeNull();
    });

    it('returns null if the entire column is air', () => {
      const blockAt = jest.fn(() => ({ type: 0, name: 'air' }));
      const block = findSurfaceBlock(blockAt, 0, 0, 5, 0);
      expect(block).toBeNull();
    });

    it('stops scanning on first null (unloaded) even if blocks exist below', () => {
      let calls = 0;
      const blockAt = jest.fn((pos: any) => {
        calls++;
        if (pos.y >= 70) return { type: 0, name: 'air' };
        return null;
      });

      const block = findSurfaceBlock(blockAt, 0, 0, 80, 0);
      expect(block).toBeNull();
      expect(calls).toBeLessThan(82);
    });

    it('returns water block when surface is water', () => {
      const blockAt = jest.fn((pos: any) => {
        if (pos.y === 62) return { type: 9, name: 'water' };
        return { type: 0, name: 'air' };
      });

      const block = findSurfaceBlock(blockAt, 0, 0, 80, 0);
      expect(block).not.toBeNull();
      expect(block.name).toBe('water');
    });

    it('floors x and z coordinates', () => {
      const blockAt = jest.fn(() => ({ type: 1, name: 'stone' }));
      findSurfaceBlock(blockAt, 10.7, 20.3, 64, 64);
      expect(blockAt).toHaveBeenCalledWith(expect.objectContaining({ x: 10, z: 20 }));
    });
  });

  describe('checkColumnSurface', () => {
    it('returns land when surface block is stone', () => {
      const blockAt = jest.fn((pos: any) => {
        if (pos.y === 64) return { type: 1, name: 'stone' };
        return { type: 0, name: 'air' };
      });

      expect(checkColumnSurface(blockAt, 10, 10, 80, 0)).toBe('land');
    });

    it('returns water when surface block is water', () => {
      const blockAt = jest.fn((pos: any) => {
        if (pos.y === 63) return { type: 9, name: 'water' };
        return { type: 0, name: 'air' };
      });

      expect(checkColumnSurface(blockAt, 10, 10, 80, 0)).toBe('water');
    });

    it('returns unknown when blockAt returns null (unloaded)', () => {
      const blockAt = jest.fn(() => null);
      expect(checkColumnSurface(blockAt, 10, 10)).toBe('unknown');
    });

    it('returns unknown when only air blocks found', () => {
      const blockAt = jest.fn(() => ({ type: 0, name: 'air' }));
      expect(checkColumnSurface(blockAt, 10, 10, 5, 0)).toBe('unknown');
    });
  });

  describe('probeDirectionForWater', () => {
    it('returns land when nearest loaded column is land', () => {
      const blockAt = jest.fn(() => ({ type: 1, name: 'stone' }));
      const result = probeDirectionForWater(blockAt, 0, 0, 0, 100, 16);
      expect(result).toBe('land');
    });

    it('returns water when nearest loaded column is water', () => {
      const blockAt = jest.fn((pos: any) => {
        if (pos.y === 62) return { type: 9, name: 'water' };
        return { type: 0, name: 'air' };
      });
      const result = probeDirectionForWater(blockAt, 0, 0, 0, 100, 16);
      expect(result).toBe('water');
    });

    it('steps back from maxDistance toward origin to find loaded chunk', () => {
      const probedXs: number[] = [];
      const blockAt = jest.fn((pos: any) => {
        if (!probedXs.includes(Math.round(pos.x))) {
          probedXs.push(Math.round(pos.x));
        }
        if (Math.abs(pos.x) > 48) return null;
        return { type: 1, name: 'stone' };
      });

      const result = probeDirectionForWater(blockAt, 0, 0, 0, 100, 16);
      expect(result).toBe('land');
      expect(probedXs[0]).toBeGreaterThan(probedXs[probedXs.length - 1]);
    });

    it('returns unknown when everything is unloaded', () => {
      const blockAt = jest.fn(() => null);
      const result = probeDirectionForWater(blockAt, 0, 0, 0, 100, 16);
      expect(result).toBe('unknown');
    });
  });

  describe('randomAngle', () => {
    it('returns a value in [0, 2pi)', () => {
      for (let i = 0; i < 50; i++) {
        const angle = randomAngle();
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThan(2 * Math.PI);
      }
    });
  });

  describe('offsetFromAngle', () => {
    it('offsets correctly along the x axis (angle 0)', () => {
      const result = offsetFromAngle(10, 20, 0, 50);
      expect(result.x).toBeCloseTo(60);
      expect(result.z).toBeCloseTo(20);
    });

    it('offsets correctly along the z axis (angle pi/2)', () => {
      const result = offsetFromAngle(0, 0, Math.PI / 2, 100);
      expect(result.x).toBeCloseTo(0);
      expect(result.z).toBeCloseTo(100);
    });

    it('produces correct distance from origin', () => {
      const result = offsetFromAngle(0, 0, 0.7, 128);
      const dist = Math.sqrt(result.x * result.x + result.z * result.z);
      expect(dist).toBeCloseTo(128);
    });
  });
});
