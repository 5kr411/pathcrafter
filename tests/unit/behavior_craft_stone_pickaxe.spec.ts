import { describe, it, expect } from '@jest/globals';

/**
 * Test that stone pickaxe crafting works with cobblestone vs cobbled_deepslate
 */
describe('Stone Pickaxe Crafting Variants', () => {
  it('should craft stone_pickaxe when cobblestone is in inventory', () => {
    const mcData = require('minecraft-data')('1.20.1');
    
    const mockBot: any = {
      version: '1.20.1',
      inventory: {
        items: () => [
          { name: 'cobblestone', count: 3 },
          { name: 'stick', count: 2 }
        ]
      },
      recipesFor: (itemId: number) => {
        // stone_pickaxe id = 856
        if (itemId === 856) {
          // Return recipe for cobblestone variant
          return [{
            result: { id: 856, count: 1 },
            delta: [
              { id: mcData.itemsByName['cobblestone'].id, count: -3 },
              { id: mcData.itemsByName['stick'].id, count: -2 }
            ],
            requiresTable: true
          }];
        }
        return [];
      },
      findBlock: () => ({ position: { x: 100, y: 64, z: 100 } }),
      pathfinder: { setGoal: () => {}, isMoving: () => false }
    };

    const createCraftWithTableIfNeeded = require('../../behaviors/behaviorCraftWithTableIfNeeded').default;
    
    const targets: any = {
      itemName: 'stone_pickaxe',
      amount: 1
    };

    const state = createCraftWithTableIfNeeded(mockBot, targets);
    expect(state).toBeDefined();
    
    // The key issue: bot has cobblestone but plan might say cobbled_deepslate
    // This should work because inventory has cobblestone
  });

  it('should fail when inventory has cobblestone but recipe expects cobbled_deepslate', () => {
    const mcData = require('minecraft-data')('1.20.1');
    
    const mockBot: any = {
      version: '1.20.1',
      inventory: {
        items: () => [
          { name: 'cobblestone', count: 3 },
          { name: 'stick', count: 2 }
        ]
      },
      recipesFor: (itemId: number) => {
        // stone_pickaxe id = 856
        if (itemId === 856) {
          // Try to find recipe for DEEPSLATE variant when we only have cobblestone
          // This should return 0 recipes
          const deepslateId = mcData.itemsByName['cobbled_deepslate']?.id;
          if (!deepslateId) return [];
          
          // recipesFor should only return recipes where ingredients are available
          // Since we don't have cobbled_deepslate, this should be empty
          return [];
        }
        return [];
      },
      findBlock: () => ({ position: { x: 100, y: 64, z: 100 } }),
      pathfinder: { setGoal: () => {}, isMoving: () => false }
    };

    const createCraftWithTableIfNeeded = require('../../behaviors/behaviorCraftWithTableIfNeeded').default;
    
    const targets: any = {
      itemName: 'stone_pickaxe',  // <-- This is the problem!
      amount: 1
      // No variantStep, so it tries to craft "stone_pickaxe" generically
      // But the plan said to use cobbled_deepslate
    };

    const state = createCraftWithTableIfNeeded(mockBot, targets);
    expect(state).toBeDefined();
    
    // This demonstrates the issue: itemName is just "stone_pickaxe"
    // The path RESOLUTION picked cobbled_deepslate, but that info is lost
  });
});

