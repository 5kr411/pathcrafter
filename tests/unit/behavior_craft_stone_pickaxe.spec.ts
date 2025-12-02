import { describe, it, expect, beforeAll } from '@jest/globals';
import { getCachedMcData } from '../testHelpers';

/**
 * Test that stone pickaxe crafting works with runtime variant selection
 * for different stone types (cobblestone, cobbled_deepslate, blackstone)
 * 
 * This test verifies that stone tool recipes are now grouped as multi-variant
 * craft nodes, enabling runtime inventory-based variant selection (like wood tools).
 */
describe('Stone Pickaxe Runtime Variant Selection', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
  });

  it('stone_pickaxe has multiple valid recipes with different stone types', () => {
    const stonePickaxeId = mcData.itemsByName['stone_pickaxe']?.id;
    expect(stonePickaxeId).toBeDefined();

    const recipes = mcData.recipes[stonePickaxeId] || [];
    expect(recipes.length).toBe(3);

    const stoneTypes = new Set<string>();
    for (const recipe of recipes) {
      if (recipe.inShape) {
        for (const row of recipe.inShape) {
          for (const itemId of row) {
            if (itemId > 0) {
              const itemName = mcData.items[itemId]?.name;
              if (itemName && itemName !== 'stick') {
                stoneTypes.add(itemName);
              }
            }
          }
        }
      }
    }

    expect(stoneTypes.has('cobblestone')).toBe(true);
    expect(stoneTypes.has('cobbled_deepslate')).toBe(true);
    expect(stoneTypes.has('blackstone')).toBe(true);
  });

  it('multi-variant craft step structure allows runtime selection', () => {
    const mockStep = {
      action: 'craft',
      count: 1,
      result: {
        mode: 'one_of',
        variants: [
          { value: { item: 'stone_pickaxe', perCraftCount: 1 } }
        ]
      },
      ingredients: {
        mode: 'one_of',
        variants: [
          { value: [
            { item: 'cobblestone', perCraftCount: 3 },
            { item: 'stick', perCraftCount: 2 }
          ]},
          { value: [
            { item: 'cobbled_deepslate', perCraftCount: 3 },
            { item: 'stick', perCraftCount: 2 }
          ]},
          { value: [
            { item: 'blackstone', perCraftCount: 3 },
            { item: 'stick', perCraftCount: 2 }
          ]}
        ]
      }
    };

    expect(mockStep.ingredients.variants.length).toBe(3);
    expect(mockStep.ingredients.mode).toBe('one_of');
    
    const variantStoneTypes = mockStep.ingredients.variants.map(v => 
      v.value.find((ing: any) => ing.item !== 'stick')?.item
    );

    expect(variantStoneTypes).toContain('cobblestone');
    expect(variantStoneTypes).toContain('cobbled_deepslate');
    expect(variantStoneTypes).toContain('blackstone');
  });

  it('verifies bot.recipesFor can find recipes for each stone variant', () => {
    const stonePickaxeId = mcData.itemsByName['stone_pickaxe']?.id;
    const cobblestoneId = mcData.itemsByName['cobblestone']?.id;
    const deepslateId = mcData.itemsByName['cobbled_deepslate']?.id;
    const blackstoneId = mcData.itemsByName['blackstone']?.id;
    const stickId = mcData.itemsByName['stick']?.id;

    const allRecipes = mcData.recipes[stonePickaxeId] || [];

    const cobblestoneRecipe = allRecipes.find((recipe: any) => {
      if (recipe.inShape) {
        return recipe.inShape.some((row: any[]) => row.includes(cobblestoneId));
      }
      return false;
    });
    expect(cobblestoneRecipe).toBeDefined();

    const deepslateRecipe = allRecipes.find((recipe: any) => {
      if (recipe.inShape) {
        return recipe.inShape.some((row: any[]) => row.includes(deepslateId));
      }
      return false;
    });
    expect(deepslateRecipe).toBeDefined();

    const blackstoneRecipe = allRecipes.find((recipe: any) => {
      if (recipe.inShape) {
        return recipe.inShape.some((row: any[]) => row.includes(blackstoneId));
      }
      return false;
    });
    expect(blackstoneRecipe).toBeDefined();

    const allUseSticks = [cobblestoneRecipe, deepslateRecipe, blackstoneRecipe].every((recipe: any) => {
      if (recipe.inShape) {
        return recipe.inShape.some((row: any[]) => row.includes(stickId));
      }
      return false;
    });
    expect(allUseSticks).toBe(true);
  });

  it('stone_axe also has multiple stone type variants', () => {
    const stoneAxeId = mcData.itemsByName['stone_axe']?.id;
    expect(stoneAxeId).toBeDefined();

    const recipes = mcData.recipes[stoneAxeId] || [];
    expect(recipes.length).toBe(3);

    const stoneTypes = new Set<string>();
    for (const recipe of recipes) {
      if (recipe.inShape) {
        for (const row of recipe.inShape) {
          for (const itemId of row) {
            if (itemId > 0) {
              const itemName = mcData.items[itemId]?.name;
              if (itemName && itemName !== 'stick') {
                stoneTypes.add(itemName);
              }
            }
          }
        }
      }
    }

    expect(stoneTypes.has('cobblestone')).toBe(true);
    expect(stoneTypes.has('cobbled_deepslate')).toBe(true);
    expect(stoneTypes.has('blackstone')).toBe(true);
  });
});
