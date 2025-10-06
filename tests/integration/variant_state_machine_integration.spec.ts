import { createBehaviorForStep } from '../../behavior_generator';
import { setCurrentSpeciesContext, getCurrentSpeciesContext } from '../../utils/context';
import { ActionStep } from '../../action_tree/types';

describe('integration: variant state machine creation', () => {
  beforeEach(() => {
    // Clear species context before each test
    setCurrentSpeciesContext(null);
  });

  test('creates mineOneOf behavior for mining steps with variants', () => {
    const step: ActionStep = {
      action: 'mine',
      what: 'oak_log',
      count: 3,
      whatVariants: ['oak_log', 'spruce_log', 'birch_log'],
      targetItemVariants: ['oak_log', 'spruce_log', 'birch_log']
    };

    const bot = {
      version: '1.20.1',
      inventory: { items: () => [] },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [
        { x: 5, y: 64, z: 0 }, // oak_log nearby
        { x: 10, y: 64, z: 0 }, // spruce_log further
        { x: 15, y: 64, z: 0 }  // birch_log furthest
      ]
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');
  });

  test('creates craftVariant behavior for crafting steps with variants', () => {
    const step: ActionStep = {
      action: 'craft',
      what: 'inventory',
      count: 2,
      result: { item: 'oak_planks', perCraftCount: 4 },
      resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks']
    };

    const bot = {
      version: '1.20.1',
      inventory: { 
        items: () => [],
        slots: Array(36).fill(null),
        firstEmptyInventorySlot: () => 9
      },
      recipesFor: () => [],
      craft: () => Promise.resolve(),
      moveSlotItem: () => Promise.resolve()
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');
  });

  test('craftVariant respects species context from previous mining', () => {
    // Simulate that we mined spruce logs previously
    setCurrentSpeciesContext('spruce');

    const step: ActionStep = {
      action: 'craft',
      what: 'inventory',
      count: 1,
      result: { item: 'oak_planks', perCraftCount: 4 },
      resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks']
    };

    const bot = {
      version: '1.20.1',
      inventory: { 
        items: () => [],
        slots: Array(36).fill(null),
        firstEmptyInventorySlot: () => 9
      },
      recipesFor: () => [],
      craft: () => Promise.resolve(),
      moveSlotItem: () => Promise.resolve()
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');

    // Species context should still be spruce
    expect(getCurrentSpeciesContext()).toBe('spruce');
  });

  test('regular mine behavior handles steps without variants', () => {
    const step: ActionStep = {
      action: 'mine',
      what: 'oak_log',
      count: 3
    };

    const bot = {
      version: '1.20.1',
      inventory: { items: () => [] },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [{ x: 5, y: 64, z: 0 }]
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');
  });

  test('regular craft behavior handles steps without variants', () => {
    const step: ActionStep = {
      action: 'craft',
      what: 'inventory',
      count: 2,
      result: { item: 'stick', perCraftCount: 4 }
    };

    const bot = {
      version: '1.20.1',
      inventory: { 
        items: () => [],
        slots: Array(36).fill(null),
        firstEmptyInventorySlot: () => 9
      },
      recipesFor: () => [],
      craft: () => Promise.resolve(),
      moveSlotItem: () => Promise.resolve()
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');
  });

  test('table crafting with variants respects species context', () => {
    setCurrentSpeciesContext('birch');

    const step: ActionStep = {
      action: 'craft',
      what: 'table',
      count: 1,
      result: { item: 'oak_door', perCraftCount: 1 },
      resultVariants: ['oak_door', 'spruce_door', 'birch_door']
    };

    const bot = {
      version: '1.20.1',
      inventory: { 
        items: () => [],
        slots: Array(36).fill(null),
        firstEmptyInventorySlot: () => 9
      },
      recipesFor: () => [],
      craft: () => Promise.resolve(),
      moveSlotItem: () => Promise.resolve(),
      findBlocks: () => [],
      findBlock: () => null,
      blockAt: () => null
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');
  });

  test('behavior generator handles mixed variant and non-variant steps', () => {
    const steps: ActionStep[] = [
      {
        action: 'mine',
        what: 'oak_log',
        count: 3,
        whatVariants: ['oak_log', 'spruce_log', 'birch_log']
      },
      {
        action: 'craft',
        what: 'inventory',
        count: 1,
        result: { item: 'stick', perCraftCount: 4 }
      },
      {
        action: 'craft',
        what: 'inventory',
        count: 2,
        result: { item: 'oak_planks', perCraftCount: 4 },
        resultVariants: ['oak_planks', 'spruce_planks', 'birch_planks']
      }
    ];

    const bot = {
      version: '1.20.1',
      inventory: { 
        items: () => [],
        slots: Array(36).fill(null),
        firstEmptyInventorySlot: () => 9
      },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [{ x: 5, y: 64, z: 0 }],
      recipesFor: () => [],
      craft: () => Promise.resolve(),
      moveSlotItem: () => Promise.resolve()
    } as any;

    // Test that all steps can be handled
    steps.forEach(step => {
      const behavior = createBehaviorForStep(bot, step);
      expect(behavior).toBeTruthy();
      expect(typeof behavior!.isFinished).toBe('function');
    });
  });

  test('legacy meta-based mineOneOf still works', () => {
    const step = {
      action: 'mine' as const,
      what: 'oak_log',
      count: 2,
      meta: { 
        oneOfCandidates: [ 
          { blockName: 'oak_log' }, 
          { blockName: 'spruce_log' } 
        ] 
      }
    };

    const bot = {
      version: '1.20.1',
      inventory: { items: () => [] },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [
        { x: 5, y: 64, z: 0 },
        { x: 10, y: 64, z: 0 }
      ]
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');
  });
});
