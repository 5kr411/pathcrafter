import {
  countRawMeatInInventory,
  evaluateHuntDropCandidate,
  findClosestHuntableAnimal,
  getRawMeatDrop,
  hasSwordInInventory,
  isActualDroppedItem,
  isDropCollectTimedOut
} from '../../behaviors/huntForFoodHelpers';

function makePos(x: number, y: number, z: number) {
  return {
    x,
    y,
    z,
    distanceTo(other: any) {
      const dx = x - other.x;
      const dy = y - other.y;
      const dz = z - other.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  };
}

describe('huntForFoodHelpers', () => {
  describe('findClosestHuntableAnimal', () => {
    it('finds the closest valid animal and respects filters', () => {
      const animals = [
        { entity: 'cow', drops: ['beef'] },
        { entity: 'pig', drops: ['porkchop'] }
      ];
      const bot = {
        entity: { position: makePos(0, 0, 0) },
        entities: {
          a: { name: 'cow', position: makePos(5, 0, 0), health: 10 },
          b: { name: 'cow', position: makePos(2, 0, 0), health: 10 },
          c: { name: 'pig', position: makePos(1, 0, 0), health: 10 }
        }
      };

      const closestCow = findClosestHuntableAnimal(bot as any, ['cow'], animals);
      expect(closestCow?.animalType).toBe('cow');
      expect(closestCow?.entity).toBe(bot.entities.b);

      const closestPig = findClosestHuntableAnimal(bot as any, ['pig'], animals);
      expect(closestPig?.animalType).toBe('pig');
      expect(closestPig?.entity).toBe(bot.entities.c);
    });
  });

  describe('getRawMeatDrop', () => {
    it('returns the first drop for an animal type', () => {
      const animals = [{ entity: 'cow', drops: ['beef', 'leather'] }];
      expect(getRawMeatDrop('cow', animals)).toBe('beef');
    });
  });

  describe('countRawMeatInInventory', () => {
    it('counts only raw meat items from inventory', () => {
      const animals = [
        { entity: 'cow', drops: ['beef'] },
        { entity: 'pig', drops: ['porkchop'] }
      ];
      const inventory = { beef: 2, porkchop: 1, apple: 5 };
      expect(countRawMeatInInventory(inventory, animals)).toEqual([
        { rawItem: 'beef', count: 2 },
        { rawItem: 'porkchop', count: 1 }
      ]);
    });
  });

  describe('isActualDroppedItem', () => {
    it('returns true for item entities', () => {
      expect(isActualDroppedItem({ name: 'item' })).toBe(true);
    });

    it('returns true when getDroppedItem is available', () => {
      expect(isActualDroppedItem({ getDroppedItem: () => ({ name: 'beef' }) })).toBe(true);
    });

    it('returns false for non-item entities', () => {
      expect(isActualDroppedItem({ name: 'cow' })).toBe(false);
    });
  });

  describe('evaluateHuntDropCandidate', () => {
    it('skips when bot position is missing', () => {
      const result = evaluateHuntDropCandidate({
        entity: { position: makePos(0, 0, 0), name: 'item' },
        botPos: null,
        killPosition: makePos(1, 0, 0),
        dropCollectRadius: 8,
        botRange: 16
      });

      expect(result.ok).toBe(false);
    });

    it('skips when drop already attempted', () => {
      const result = evaluateHuntDropCandidate({
        entity: { id: 42, position: makePos(0, 0, 0), name: 'item' },
        botPos: makePos(0, 0, 0),
        killPosition: makePos(1, 0, 0),
        attemptedDropIds: new Set([42]),
        dropCollectRadius: 8,
        botRange: 16
      });

      expect(result.ok).toBe(false);
    });

    it('returns true when near kill position and in range', () => {
      const mcData = { items: [] as Array<{ name?: string }> };
      mcData.items[5] = { name: 'beef' };

      const entity = {
        id: 1,
        position: makePos(2, 0, 0),
        metadata: [] as any[],
        name: 'item'
      };
      entity.metadata[7] = { itemId: 5, itemCount: 2 };

      const result = evaluateHuntDropCandidate({
        entity,
        botPos: makePos(0, 0, 0),
        killPosition: makePos(3, 0, 0),
        dropCollectRadius: 8,
        botRange: 16,
        mcData
      });

      expect(result.ok).toBe(true);
      expect(result.dropInfo.name).toBe('beef');
    });

    it('returns false when too far from kill position', () => {
      const result = evaluateHuntDropCandidate({
        entity: { position: makePos(20, 0, 0), name: 'item' },
        botPos: makePos(0, 0, 0),
        killPosition: makePos(0, 0, 0),
        dropCollectRadius: 8,
        botRange: 16
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('isDropCollectTimedOut', () => {
    it('returns true when timeout exceeded', () => {
      expect(isDropCollectTimedOut(1000, 3500, 2000)).toBe(true);
    });

    it('returns false when within timeout window', () => {
      expect(isDropCollectTimedOut(1000, 2500, 2000)).toBe(false);
    });
  });

  describe('hasSwordInInventory', () => {
    it('detects swords in inventory', () => {
      expect(hasSwordInInventory({ stone_sword: 1 })).toBe(true);
      expect(hasSwordInInventory({ iron_pickaxe: 1 })).toBe(false);
    });
  });
});
