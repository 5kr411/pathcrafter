/**
 * Unit tests for recipe utilities
 */

import { 
  getItemName, 
  requiresCraftingTable, 
  getRecipeCanonicalKey, 
  canonicalizeShapedRecipe, 
  canonicalizeShapelessRecipe, 
  dedupeRecipesForItem, 
  getIngredientCounts, 
  hasCircularDependency, 
  findFurnaceSmeltsForItem 
} from '../../action_tree/utils/recipeUtils';

describe('recipeUtils', () => {
  const mockMcData = {
    version: '1.19.2',
    items: {
      1: { id: 1, name: 'oak_log' },
      2: { id: 2, name: 'spruce_log' },
      3: { id: 3, name: 'oak_planks' },
      4: { id: 4, name: 'spruce_planks' },
      5: { id: 5, name: 'stick' }
    },
    itemsByName: {
      'oak_log': { id: 1, name: 'oak_log' },
      'spruce_log': { id: 2, name: 'spruce_log' },
      'oak_planks': { id: 3, name: 'oak_planks' },
      'spruce_planks': { id: 4, name: 'spruce_planks' },
      'stick': { id: 5, name: 'stick' },
      'iron_ingot': { id: 6, name: 'iron_ingot' },
      'raw_iron': { id: 7, name: 'raw_iron' }
    },
    recipes: {
      3: [ // oak_planks recipes
        { inShape: [[1, 1], [1, 1]], result: { id: 3, count: 4 } },
        { ingredients: [1, 1, 1, 1], result: { id: 3, count: 4 } }
      ],
      4: [ // spruce_planks recipes
        { inShape: [[2, 2], [2, 2]], result: { id: 4, count: 4 } },
        { ingredients: [2, 2, 2, 2], result: { id: 4, count: 4 } }
      ],
      5: [ // stick recipes
        { inShape: [[3], [3]], result: { id: 5, count: 4 } } // requires planks
      ]
    },
    blocks: {},
    entityLoot: {}
  } as any;

  describe('getItemName', () => {
    test('returns item name for valid ID', () => {
      expect(getItemName(mockMcData, 1)).toBe('oak_log');
      expect(getItemName(mockMcData, 2)).toBe('spruce_log');
    });

    test('returns string representation for invalid ID', () => {
      expect(getItemName(mockMcData, 999)).toBe('999');
    });
  });

  describe('requiresCraftingTable', () => {
    test('returns false for shapeless recipes', () => {
      const recipe = { ingredients: [1, 2, 3], result: { id: 1, count: 1 } };
      expect(requiresCraftingTable(recipe)).toBe(false);
    });

    test('returns false for 2x2 shaped recipes', () => {
      const recipe = { inShape: [[1, 2], [3, 4]], result: { id: 1, count: 1 } };
      expect(requiresCraftingTable(recipe)).toBe(false);
    });

    test('returns true for wide shaped recipes', () => {
      const recipe = { inShape: [[1, 2, 3], [4, 5, 6]], result: { id: 1, count: 1 } };
      expect(requiresCraftingTable(recipe)).toBe(true);
    });

    test('returns true for tall shaped recipes', () => {
      const recipe = { inShape: [[1, 2], [3, 4], [5, 6]], result: { id: 1, count: 1 } };
      expect(requiresCraftingTable(recipe)).toBe(true);
    });

    test('returns false for other recipe types', () => {
      const recipe = { result: { id: 1, count: 1 } };
      expect(requiresCraftingTable(recipe)).toBe(false);
    });
  });

  describe('getRecipeCanonicalKey', () => {
    test('creates key for shaped recipes', () => {
      const recipe = { inShape: [[1, 2], [3, 4]], result: { id: 1, count: 1 } };
      const key = getRecipeCanonicalKey(recipe);
      expect(key).toContain('shaped:');
      expect(key).toContain('false:'); // no table required
      expect(key).toContain('1:'); // result count
    });

    test('creates key for shapeless recipes', () => {
      const recipe = { ingredients: [1, 2, 3], result: { id: 1, count: 2 } };
      const key = getRecipeCanonicalKey(recipe);
      expect(key).toContain('shapeless:');
      expect(key).toContain('false:'); // no table required
      expect(key).toContain('2:'); // result count
      expect(key).toContain('3'); // ingredient count
    });

    test('creates key for other recipes', () => {
      const recipe = { result: { id: 1, count: 1 } };
      const key = getRecipeCanonicalKey(recipe);
      expect(key).toBe('other:false:1');
    });
  });

  describe('canonicalizeShapedRecipe', () => {
    test('canonicalizes shaped recipe with wood types', () => {
      const recipe = { inShape: [[1, 2], [1, 2]], result: { id: 1, count: 4 } }; // oak_log, spruce_log
      const canonical = canonicalizeShapedRecipe(mockMcData, recipe);
      expect(canonical).toContain('log');
    });

    test('handles null/undefined cells', () => {
      const recipe = { inShape: [[1, null], [null, 2]], result: { id: 1, count: 1 } } as any;
      const canonical = canonicalizeShapedRecipe(mockMcData, recipe);
      expect(canonical).toContain('0'); // null/undefined become 0
    });
  });

  describe('canonicalizeShapelessRecipe', () => {
    test('canonicalizes shapeless recipe with wood types', () => {
      const recipe = { ingredients: [1, 2, 1, 2], result: { id: 1, count: 4 } }; // oak_log, spruce_log
      const canonical = canonicalizeShapelessRecipe(mockMcData, recipe);
      expect(canonical).toContain('log');
    });

    test('filters out null/undefined ingredients', () => {
      const recipe = { ingredients: [1, null, 2, undefined], result: { id: 1, count: 1 } } as any;
      const canonical = canonicalizeShapelessRecipe(mockMcData, recipe);
      expect(canonical).not.toContain('null');
      expect(canonical).not.toContain('undefined');
    });
  });

  describe('dedupeRecipesForItem', () => {
    test('returns all recipes when preferFamilies is false', () => {
      const recipes = dedupeRecipesForItem(mockMcData, 3, false);
      expect(recipes).toHaveLength(2);
    });

    test('deduplicates recipes when preferFamilies is true', () => {
      const recipes = dedupeRecipesForItem(mockMcData, 3, true);
      expect(recipes).toHaveLength(2); // One shaped, one shapeless
    });

    test('returns empty array for item with no recipes', () => {
      const recipes = dedupeRecipesForItem(mockMcData, 999, true);
      expect(recipes).toHaveLength(0);
    });
  });

  describe('getIngredientCounts', () => {
    test('counts ingredients in shaped recipe', () => {
      const recipe = { inShape: [[1, 1], [2, 2]], result: { id: 1, count: 1 } };
      const counts = getIngredientCounts(recipe);
      expect(counts.get(1)).toBe(2);
      expect(counts.get(2)).toBe(2);
    });

    test('counts ingredients in shapeless recipe', () => {
      const recipe = { ingredients: [1, 1, 2], result: { id: 1, count: 1 } };
      const counts = getIngredientCounts(recipe);
      expect(counts.get(1)).toBe(2);
      expect(counts.get(2)).toBe(1);
    });

    test('returns empty map for recipe with no ingredients', () => {
      const recipe = { result: { id: 1, count: 1 } };
      const counts = getIngredientCounts(recipe);
      expect(counts.size).toBe(0);
    });

    test('handles null/undefined ingredients', () => {
      const recipe = { ingredients: [1, null, 2, undefined], result: { id: 1, count: 1 } } as any;
      const counts = getIngredientCounts(recipe);
      expect(counts.get(1)).toBe(1);
      expect(counts.get(2)).toBe(1);
      expect(counts.has(null as any)).toBe(false);
      expect(counts.has(undefined as any)).toBe(false);
    });
  });

  describe('hasCircularDependency', () => {
    test('detects circular dependency', () => {
      // Mock recipes where planks require sticks and sticks require planks
      const circularMcData = {
        ...mockMcData,
        recipes: {
          3: [{ ingredients: [5], result: { id: 3, count: 1 } }], // planks require stick
          5: [{ inShape: [[3], [3]], result: { id: 5, count: 4 } }] // stick requires planks
        }
      };
      
      expect(hasCircularDependency(circularMcData, 3, 5)).toBe(true);
    });

    test('returns false for non-circular dependency', () => {
      expect(hasCircularDependency(mockMcData, 1, 2)).toBe(false);
    });

    test('returns false for item with no recipes', () => {
      expect(hasCircularDependency(mockMcData, 999, 1)).toBe(false);
    });
  });

  describe('findFurnaceSmeltsForItem', () => {
    test('filters out non-existent items', () => {
      // Mock getFurnaceInputsFor to return items that don't exist
      jest.doMock('../../utils/smeltingConfig', () => ({
        getFurnaceInputsFor: () => ['raw_iron', 'nonexistent_item']
      }));

      const inputs = findFurnaceSmeltsForItem(mockMcData, 'iron_ingot');
      expect(inputs).toContain('raw_iron');
      expect(inputs).not.toContain('nonexistent_item');

      jest.dontMock('../../utils/smeltingConfig');
    });
  });
});
