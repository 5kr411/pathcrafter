import { findObstructingBlock, canSeeTargetBlock } from '../../utils/raycasting';

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
    }
  };
  return bot;
}

describe('unit: raycasting obstruction detection', () => {
  describe('findObstructingBlock with single obstruction', () => {
    test('should detect single block between bot and target', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.x).toBe(2);
      expect(obstruction?.position?.y).toBe(65);
      expect(obstruction?.position?.z).toBe(0);
    });
  });

  describe('findObstructingBlock with multiple obstructions', () => {
    test('should detect closest of 2 blocks between bot and target', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 1);
      blockTypes.set('3,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.x).toBe(2);
      expect(obstruction?.position?.y).toBe(65);
      expect(obstruction?.position?.z).toBe(0);
    });

    test('should continue finding obstructions after first is cleared', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 1);
      blockTypes.set('3,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction1 = findObstructingBlock(bot, targets);
      expect(obstruction1?.position?.x).toBe(2);
      
      blockTypes.delete('2,65,0');
      
      const obstruction2 = findObstructingBlock(bot, targets);
      expect(obstruction2?.position?.x).toBe(3);
      
      blockTypes.delete('3,65,0');
      
      const obstruction3 = findObstructingBlock(bot, targets);
      expect(obstruction3).toBeNull();
    });

    test('should handle 4+ obstructions in sequence', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('1,65,0', 1);
      blockTypes.set('2,65,0', 1);
      blockTypes.set('3,65,0', 1);
      blockTypes.set('4,65,0', 1);
      blockTypes.set('6,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(6, 65, 0)
      };
      
      const obstructions: number[] = [];
      
      for (let i = 0; i < 5; i++) {
        const obstruction = findObstructingBlock(bot, targets);
        if (obstruction && obstruction.position) {
          obstructions.push(obstruction.position.x);
          const key = `${obstruction.position.x},${obstruction.position.y},${obstruction.position.z}`;
          blockTypes.delete(key);
        } else {
          break;
        }
      }
      
      expect(obstructions).toEqual([1, 2, 3, 4]);
      
      const finalCheck = findObstructingBlock(bot, targets);
      expect(finalCheck).toBeNull();
    });
  });

  describe('findObstructingBlock with non-solid blocks', () => {
    test('should skip air blocks (type 0)', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 0);
      blockTypes.set('3,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.x).toBe(3);
    });

    test('should skip water blocks (type 8/9)', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 8);
      blockTypes.set('3,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.x).toBe(3);
    });

    test('should skip lava blocks (type 10/11)', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 10);
      blockTypes.set('3,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.x).toBe(3);
    });

    test('should skip blocks with boundingBox=empty', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 8);
      blockTypes.set('3,65,0', 9);
      blockTypes.set('4,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.x).toBe(4);
      expect(obstruction?.boundingBox).toBe('block');
    });

    test('should handle mixed solid and non-solid blocks', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('1,65,0', 1);
      blockTypes.set('2,65,0', 8);
      blockTypes.set('3,65,0', 10);
      blockTypes.set('4,65,0', 1);
      blockTypes.set('5,65,0', 0);
      blockTypes.set('7,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(7, 65, 0)
      };
      
      const obstructions: number[] = [];
      
      for (let i = 0; i < 5; i++) {
        const obstruction = findObstructingBlock(bot, targets);
        if (obstruction && obstruction.position) {
          obstructions.push(obstruction.position.x);
          const key = `${obstruction.position.x},${obstruction.position.y},${obstruction.position.z}`;
          blockTypes.delete(key);
        } else {
          break;
        }
      }
      
      expect(obstructions).toEqual([1, 4]);
    });
  });

  describe('canSeeTargetBlock integration', () => {
    test('should return false when obstructions exist', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const canSee = canSeeTargetBlock(bot, targets);
      expect(canSee).toBe(false);
    });

    test('should return true when no obstructions exist', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const canSee = canSeeTargetBlock(bot, targets);
      expect(canSee).toBe(true);
    });

    test('should return true when only non-solid blocks are in the way', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,0', 8);
      blockTypes.set('3,65,0', 10);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const canSee = canSeeTargetBlock(bot, targets);
      expect(canSee).toBe(true);
    });
  });

  describe('diagonal and vertical raycasting', () => {
    test('should detect obstructions on diagonal path', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('2,65,2', 1);
      blockTypes.set('5,65,5', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 5)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.x).toBe(2);
      expect(obstruction?.position?.z).toBe(2);
    });

    test('should detect obstructions on vertical path', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('0,67,0', 1);
      blockTypes.set('0,70,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(0, 70, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).not.toBeNull();
      expect(obstruction?.position?.y).toBe(67);
    });
  });

  describe('edge cases', () => {
    test('should not detect bot position as obstruction', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('0,64,0', 1);
      blockTypes.set('0,65,0', 1);
      blockTypes.set('5,65,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(5, 65, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).toBeNull();
    });

    test('should return null when target is at bot position', () => {
      const blockTypes = new Map<string, number>();
      blockTypes.set('0,64,0', 1);
      
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {
        blockPosition: vec3(0, 64, 0)
      };
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).toBeNull();
    });

    test('should return null when no blockPosition provided', () => {
      const blockTypes = new Map<string, number>();
      const bot = createMockBot({ x: 0, y: 64, z: 0 }, blockTypes);
      const targets = {};
      
      const obstruction = findObstructingBlock(bot, targets);
      
      expect(obstruction).toBeNull();
    });
  });
});

