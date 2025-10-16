import { describe, it, expect, beforeEach } from '@jest/globals';
import { findIngredientAlternativesFromRecipes } from '../../action_tree/utils/itemSimilarity';

describe('unit: itemSimilarity - recipe-based alternatives', () => {
  let mcData: any;

  beforeEach(() => {
    mcData = require('minecraft-data')('1.20.1');
  });

  describe('findIngredientAlternativesFromRecipes', () => {
    it('should find all stone-tier materials as alternatives for stone_pickaxe', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'stone_pickaxe', 'cobblestone');
      
      expect(alternatives).toContain('cobblestone');
      expect(alternatives).toContain('cobbled_deepslate');
      expect(alternatives).toContain('blackstone');
      expect(alternatives.length).toBeGreaterThanOrEqual(3);
    });

    it('should find all stone-tier materials when starting from cobbled_deepslate', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'stone_pickaxe', 'cobbled_deepslate');
      
      expect(alternatives).toContain('cobblestone');
      expect(alternatives).toContain('cobbled_deepslate');
      expect(alternatives).toContain('blackstone');
      expect(alternatives.length).toBeGreaterThanOrEqual(3);
    });

    it('should find all stone-tier materials when starting from blackstone', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'stone_pickaxe', 'blackstone');
      
      expect(alternatives).toContain('cobblestone');
      expect(alternatives).toContain('cobbled_deepslate');
      expect(alternatives).toContain('blackstone');
      expect(alternatives.length).toBeGreaterThanOrEqual(3);
    });

    it('should work for stone_axe as well', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'stone_axe', 'cobblestone');
      
      expect(alternatives).toContain('cobblestone');
      expect(alternatives).toContain('cobbled_deepslate');
      expect(alternatives).toContain('blackstone');
      expect(alternatives.length).toBeGreaterThanOrEqual(3);
    });

    it('should find wood alternatives for wooden tools (regression test)', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'oak_planks', 'oak_log');
      
      expect(alternatives).toContain('oak_log');
      expect(alternatives).toContain('oak_wood');
      expect(alternatives.length).toBeGreaterThanOrEqual(2);
    });

    it('should return single item when no alternatives exist', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'iron_pickaxe', 'iron_ingot');
      
      expect(alternatives).toEqual(['iron_ingot']);
    });

    it('should return single item for non-existent result item', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'nonexistent_item', 'cobblestone');
      
      expect(alternatives).toEqual(['cobblestone']);
    });

    it('should return single item for non-existent ingredient', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'stone_pickaxe', 'nonexistent_ingredient');
      
      expect(alternatives).toEqual(['nonexistent_ingredient']);
    });

    it('should handle stick ingredient in stone_pickaxe without grouping sticks', () => {
      const alternatives = findIngredientAlternativesFromRecipes(mcData, 'stone_pickaxe', 'stick');
      
      expect(alternatives).toEqual(['stick']);
    });
  });
});
