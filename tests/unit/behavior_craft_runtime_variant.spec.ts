import { describe, it, expect, beforeEach } from '@jest/globals';

/**
 * Test that craft behaviors can select variants at runtime based on inventory
 */
describe('Craft Runtime Variant Selection', () => {
  let mockBot: any;
  let createCraftNoTableState: any;

  beforeEach(() => {
    // Mock bot with jungle_log in inventory
    mockBot = {
      version: '1.20.1',
      inventory: {
        slots: [null, null, null, null, null], // crafting slots empty
        firstEmptyInventorySlot: () => 5,
        items: () => [
          { name: 'jungle_log', count: 5 }
        ]
      },
      recipesFor: (itemId: number) => {
        // Return jungle_planks recipe when bot has jungle_log
        if (itemId === 36) { // planks
          return [{
            result: { id: 223, count: 4 }, // jungle_planks
            delta: [{ id: 52, count: -1 }], // -1 jungle_log
            requiresTable: false
          }];
        }
        return [];
      },
      recipesAll: () => [],
      craft: jest.fn().mockResolvedValue(undefined),
      moveSlotItem: jest.fn().mockResolvedValue(undefined)
    };

    // Require the actual module
    createCraftNoTableState = require('../../behaviors/behaviorCraftNoTable').default;
  });

  it('should NOT exit early when variantStep is provided', () => {
    const mockStep = {
      action: 'craft',
      count: 1,
      result: {
        mode: 'one_of',
        variants: [
          { value: { item: 'oak_planks', perCraftCount: 4 } },
          { value: { item: 'jungle_planks', perCraftCount: 4 } }
        ]
      },
      ingredients: {
        mode: 'one_of',
        variants: [
          { value: [{ item: 'oak_log', perCraftCount: 1 }] },
          { value: [{ item: 'jungle_log', perCraftCount: 1 }] }
        ]
      }
    };

    const targets = {
      amount: 4,
      variantStep: mockStep
      // Note: itemName is NOT set, but variantStep IS
    };

    const state = createCraftNoTableState(mockBot, targets);

    // Find the enterToExit transition
    const enterToExit = state.transitions.find((t: any) => 
      t.name && t.name.includes('enter -> exit')
    );
    expect(enterToExit).toBeDefined();

    // THE BUG: This should return FALSE because variantStep is set
    // But currently it returns TRUE because itemName is null
    const shouldExit = enterToExit.shouldTransition();
    
    // This test will FAIL with current code - that's the point
    expect(shouldExit).toBe(false);
  });

  it('should select jungle_planks when jungle_log is in inventory', () => {
    const mockStep = {
      action: 'craft',
      count: 1,
      result: {
        mode: 'one_of',
        variants: [
          { value: { item: 'oak_planks', perCraftCount: 4 } },
          { value: { item: 'jungle_planks', perCraftCount: 4 } }
        ]
      },
      ingredients: {
        mode: 'one_of',
        variants: [
          { value: [{ item: 'oak_log', perCraftCount: 1 }] },
          { value: [{ item: 'jungle_log', perCraftCount: 1 }] }
        ]
      }
    };

    const targets: any = {
      amount: 4,
      variantStep: mockStep
    };

    const state = createCraftNoTableState(mockBot, targets);

    // Find the enterToWaitForCraft transition
    const enterToWait = state.transitions.find((t: any) => 
      t.name && t.name.includes('enter -> wait for craft')
    );
    expect(enterToWait).toBeDefined();

    // Trigger the transition (this is where variant selection happens)
    enterToWait.onTransition();

    // After the transition, targets.itemName should be set to jungle_planks
    expect(targets.itemName).toBe('jungle_planks');
  });

  it('should exit early if no matching variant found in inventory', async () => {
    const mockStepNoMatch = {
      action: 'craft',
      count: 1,
      result: {
        mode: 'one_of',
        variants: [
          { value: { item: 'oak_planks', perCraftCount: 4 } },
          { value: { item: 'spruce_planks', perCraftCount: 4 } }
        ]
      },
      ingredients: {
        mode: 'one_of',
        variants: [
          { value: [{ item: 'oak_log', perCraftCount: 1 }] },
          { value: [{ item: 'spruce_log', perCraftCount: 1 }] }
        ]
      }
    };

    const targets = {
      amount: 4,
      variantStep: mockStepNoMatch
    };

    createCraftNoTableState(mockBot, targets);
    
    // Give it time to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // The bot should NOT have called craft (no matching variant)
    expect(mockBot.craft).not.toHaveBeenCalled();
  });
});

