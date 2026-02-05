import {
  getHarvestToolNames,
  inventoryItemsToMap,
  isDropEntityCandidate
} from '../../behaviors/collectBlockHelpers';

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

describe('collectBlockHelpers', () => {
  describe('inventoryItemsToMap', () => {
    it('aggregates counts and defaults missing count to 1', () => {
      const items = [
        { name: 'oak_log', count: 2 },
        { name: 'oak_log', count: 3 },
        { name: 'stick' },
        { name: 'air', count: 0 },
        { name: undefined, count: 5 }
      ];

      const map = inventoryItemsToMap(items as any);
      expect(map.get('oak_log')).toBe(5);
      expect(map.get('stick')).toBe(1);
      expect(map.has('air')).toBe(false);
    });
  });

  describe('getHarvestToolNames', () => {
    it('maps harvest tool ids to item names', () => {
      const mcData = {
        items: [] as Array<{ name?: string }>,
        blocksByName: {
          stone: { harvestTools: { '1': true, '2': true } }
        }
      };
      mcData.items[1] = { name: 'wooden_pickaxe' };
      mcData.items[2] = { name: 'stone_pickaxe' };

      const names = getHarvestToolNames(null, mcData, 'stone');
      expect(names).toEqual(['wooden_pickaxe', 'stone_pickaxe']);
    });

    it('prefers explicit block harvestTools when provided', () => {
      const mcData = {
        items: [] as Array<{ name?: string }>,
        blocksByName: {
          dirt: { harvestTools: { '4': true } }
        }
      };
      mcData.items[3] = { name: 'iron_pickaxe' };
      mcData.items[4] = { name: 'golden_pickaxe' };

      const names = getHarvestToolNames({ harvestTools: { '3': true } }, mcData, 'dirt');
      expect(names).toEqual(['iron_pickaxe']);
    });
  });

  describe('isDropEntityCandidate', () => {
    it('returns false when bot position is missing', () => {
      const result = isDropEntityCandidate({
        entity: { position: makePos(0, 0, 0), displayName: 'Item' },
        botPos: null,
        targetPos: makePos(1, 0, 0),
        dropCollectRadius: 6,
        botRange: 12
      });

      expect(result.ok).toBe(false);
    });

    it('returns false when entity is not an item', () => {
      const result = isDropEntityCandidate({
        entity: { position: makePos(0, 0, 0), displayName: 'Cow' },
        botPos: makePos(0, 0, 0),
        targetPos: makePos(1, 0, 0),
        dropCollectRadius: 6,
        botRange: 12
      });

      expect(result.ok).toBe(false);
    });

    it('returns true when within target radius and bot range', () => {
      const result = isDropEntityCandidate({
        entity: { position: makePos(1, 0, 0), displayName: 'Item' },
        botPos: makePos(0, 0, 0),
        targetPos: makePos(2, 0, 0),
        dropCollectRadius: 6,
        botRange: 12
      });

      expect(result.ok).toBe(true);
      expect(result.distToTarget).toBeCloseTo(1, 3);
    });

    it('uses metadata drop info to classify as item', () => {
      const mcData = {
        items: [] as Array<{ name?: string }>
      };
      mcData.items[5] = { name: 'dirt' };

      const entity = {
        position: makePos(1, 0, 0),
        metadata: [] as any[]
      };
      entity.metadata[7] = { itemId: 5, itemCount: 1 };

      const result = isDropEntityCandidate({
        entity,
        botPos: makePos(0, 0, 0),
        targetPos: makePos(2, 0, 0),
        dropCollectRadius: 6,
        botRange: 12,
        mcData
      });

      expect(result.ok).toBe(true);
      expect(result.dropInfo.name).toBe('dirt');
    });

    it('returns false when target position is missing', () => {
      const result = isDropEntityCandidate({
        entity: { position: makePos(1, 0, 0), displayName: 'Item' },
        botPos: makePos(0, 0, 0),
        targetPos: null,
        dropCollectRadius: 6,
        botRange: 12
      });

      expect(result.ok).toBe(false);
      expect(result.distToTarget).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
