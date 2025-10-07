/**
 * Unit tests for inventory manager
 */

import { 
  createInventoryMap, 
  deductFromInventory, 
  hasEnoughInInventory, 
  getInventoryCount, 
  copyInventoryMap, 
  mergeInventoryMaps, 
  calculateMissingItems, 
  updateContextWithInventory, 
  hasPersistentItem, 
  deductTargetFromInventory 
} from '../../action_tree/builders';
import { VariantConstraintManager } from '../../action_tree/types';

describe('inventoryManager', () => {
  describe('createInventoryMap', () => {
    test('creates inventory map from context', () => {
      const context = {
        inventory: {
          'oak_log': 5,
          'coal': 10
        }
      } as any;

      const invMap = createInventoryMap(context);
      expect(invMap.get('oak_log')).toBe(5);
      expect(invMap.get('coal')).toBe(10);
    });

    test('handles empty context', () => {
      const context = {} as any;
      const invMap = createInventoryMap(context);
      expect(invMap.size).toBe(0);
    });

    test('handles null context', () => {
      const invMap = createInventoryMap(null as any);
      expect(invMap.size).toBe(0);
    });
  });

  describe('deductFromInventory', () => {
    test('deducts items from inventory', () => {
      const invMap = new Map([['oak_log', 10]]);
      const deducted = deductFromInventory(invMap, 'oak_log', 3);
      
      expect(deducted).toBe(3);
      expect(invMap.get('oak_log')).toBe(7);
    });

    test('deducts only available items', () => {
      const invMap = new Map([['oak_log', 5]]);
      const deducted = deductFromInventory(invMap, 'oak_log', 10);
      
      expect(deducted).toBe(5);
      expect(invMap.get('oak_log')).toBe(0);
    });

    test('handles non-existent items', () => {
      const invMap = new Map();
      const deducted = deductFromInventory(invMap, 'oak_log', 5);
      
      expect(deducted).toBe(0);
      expect(invMap.get('oak_log')).toBeUndefined();
    });

    test('handles null inventory map', () => {
      const deducted = deductFromInventory(null as any, 'oak_log', 5);
      expect(deducted).toBe(0);
    });
  });

  describe('hasEnoughInInventory', () => {
    test('returns true when enough items available', () => {
      const invMap = new Map([['oak_log', 10]]);
      expect(hasEnoughInInventory(invMap, 'oak_log', 5)).toBe(true);
    });

    test('returns false when not enough items available', () => {
      const invMap = new Map([['oak_log', 3]]);
      expect(hasEnoughInInventory(invMap, 'oak_log', 5)).toBe(false);
    });

    test('returns false for non-existent items', () => {
      const invMap = new Map();
      expect(hasEnoughInInventory(invMap, 'oak_log', 1)).toBe(false);
    });

    test('handles null inventory map', () => {
      expect(hasEnoughInInventory(null as any, 'oak_log', 1)).toBe(false);
    });
  });

  describe('getInventoryCount', () => {
    test('returns correct count for existing items', () => {
      const invMap = new Map([['oak_log', 7]]);
      expect(getInventoryCount(invMap, 'oak_log')).toBe(7);
    });

    test('returns 0 for non-existent items', () => {
      const invMap = new Map();
      expect(getInventoryCount(invMap, 'oak_log')).toBe(0);
    });

    test('handles null inventory map', () => {
      expect(getInventoryCount(null as any, 'oak_log')).toBe(0);
    });
  });

  describe('copyInventoryMap', () => {
    test('creates independent copy of inventory map', () => {
      const original = new Map([['oak_log', 5], ['coal', 10]]);
      const copy = copyInventoryMap(original);
      
      expect(copy.get('oak_log')).toBe(5);
      expect(copy.get('coal')).toBe(10);
      
      // Modify original
      original.set('oak_log', 0);
      
      // Copy should be unchanged
      expect(copy.get('oak_log')).toBe(5);
    });
  });

  describe('mergeInventoryMaps', () => {
    test('merges two inventory maps', () => {
      const baseMap = new Map([['oak_log', 5], ['coal', 3]]);
      const additionalMap = new Map([['oak_log', 2], ['iron', 1]]);
      
      const merged = mergeInventoryMaps(baseMap, additionalMap);
      
      expect(merged.get('oak_log')).toBe(7);
      expect(merged.get('coal')).toBe(3);
      expect(merged.get('iron')).toBe(1);
    });

    test('does not modify original maps', () => {
      const baseMap = new Map([['oak_log', 5]]);
      const additionalMap = new Map([['oak_log', 2]]);
      
      mergeInventoryMaps(baseMap, additionalMap);
      
      expect(baseMap.get('oak_log')).toBe(5);
      expect(additionalMap.get('oak_log')).toBe(2);
    });
  });

  describe('calculateMissingItems', () => {
    test('calculates missing items correctly', () => {
      const invMap = new Map([['oak_log', 3], ['coal', 10]]);
      const requiredItems = new Map([['oak_log', 5], ['coal', 8], ['iron', 2]]);
      
      const missing = calculateMissingItems(invMap, requiredItems);
      
      expect(missing.get('oak_log')).toBe(2);
      expect(missing.get('coal')).toBeUndefined(); // Have enough
      expect(missing.get('iron')).toBe(2);
    });

    test('returns empty map when all items available', () => {
      const invMap = new Map([['oak_log', 10]]);
      const requiredItems = new Map([['oak_log', 5]]);
      
      const missing = calculateMissingItems(invMap, requiredItems);
      
      expect(missing.size).toBe(0);
    });
  });

  describe('updateContextWithInventory', () => {
    test('updates context with new inventory', () => {
      const originalContext = {
        inventory: new Map([['oak_log', 5]]),
        visited: new Set(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: new VariantConstraintManager()
      } as any;
      
      const invMap = new Map([['oak_log', 10], ['coal', 3]]);
      const updatedContext = updateContextWithInventory(originalContext, invMap);
      
      expect(updatedContext.inventory).toEqual({ 'oak_log': 10, 'coal': 3 });
      expect(updatedContext.config).toBeDefined();
    });
  });

  describe('hasPersistentItem', () => {
    test('returns true for persistent items in inventory', () => {
      const invMap = new Map([['crafting_table', 1]]);
      expect(hasPersistentItem(invMap, 'crafting_table')).toBe(true);
    });

    test('returns false for missing persistent items', () => {
      const invMap = new Map([['oak_log', 5]]);
      expect(hasPersistentItem(invMap, 'crafting_table')).toBe(false);
    });
  });

  describe('deductTargetFromInventory', () => {
    test('deducts target count and returns remaining needed', () => {
      const invMap = new Map([['oak_log', 7]]);
      const stillNeeded = deductTargetFromInventory(invMap, 'oak_log', 5);
      
      expect(stillNeeded).toBe(0);
      expect(invMap.get('oak_log')).toBe(2);
    });

    test('returns remaining needed when not enough available', () => {
      const invMap = new Map([['oak_log', 3]]);
      const stillNeeded = deductTargetFromInventory(invMap, 'oak_log', 5);
      
      expect(stillNeeded).toBe(2);
      expect(invMap.get('oak_log')).toBe(0);
    });
  });
});
