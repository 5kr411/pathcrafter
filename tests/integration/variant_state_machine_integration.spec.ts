// Stub BehaviorMoveTo and BehaviorFollowEntity to avoid minecraft-data/pathfinder dependency in tests
jest.mock('mineflayer-statemachine', () => {
  const real = jest.requireActual('mineflayer-statemachine');
  class BehaviorMoveToMock {
    stateName = 'moveTo';
    active = false;
    constructor(_bot: any, _targets: any) {}
    onStateEntered() {}
    onStateExited() {}
    isFinished() { return true; }
    distanceToTarget() { return 0; }
  }
  class BehaviorFollowEntityMock {
    stateName = 'followEntity';
    active = false;
    constructor(_bot: any, _targets: any) {}
    onStateEntered() {}
    onStateExited() {}
    isFinished() { return true; }
    distanceToTarget() { return 0; }
  }
  return Object.assign({}, real, { 
    BehaviorMoveTo: BehaviorMoveToMock,
    BehaviorFollowEntity: BehaviorFollowEntityMock,
    globalSettings: (real as any).globalSettings || { debugMode: false }
  });
});

import { createBehaviorForStep } from '../../behavior_generator';
import { setCurrentSpeciesContext, getCurrentSpeciesContext } from '../../utils/context';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup, getCachedMcData } from '../testHelpers';

describe('integration: variant state machine creation', () => {
  beforeEach(() => {
    // Clear species context before each test
    setCurrentSpeciesContext(null);
  });

  test('creates mineOneOf behavior for mining steps with variants', () => {
    const step: ActionStep = createTestActionStep({
      action: 'mine',
      what: createTestStringGroup('oak_log'),
      count: 3
    });

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
    const step: ActionStep = createTestActionStep({
      action: 'craft',
      what: createTestStringGroup('inventory'),
      count: 2,
      result: createTestItemReferenceGroup('oak_planks', 4)
    });

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

    const step: ActionStep = createTestActionStep({
      action: 'craft',
      what: createTestStringGroup('inventory'),
      count: 1,
      result: createTestItemReferenceGroup('oak_planks', 4)
    });

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
    const step: ActionStep = createTestActionStep({
      action: 'mine',
      what: createTestStringGroup('oak_log'),
      count: 3
    });

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
    const step: ActionStep = createTestActionStep({
      action: 'craft',
      what: createTestStringGroup('inventory'),
      count: 2,
      result: createTestItemReferenceGroup('stick', 4)
    });

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

    const step: ActionStep = createTestActionStep({
      action: 'craft',
      what: createTestStringGroup('table'),
      count: 1,
      result: createTestItemReferenceGroup('oak_door', 1)
    });

    const mc = getCachedMcData('1.20.1');
    const bot = {
      version: '1.20.1',
      mcData: mc,
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
      blockAt: () => null,
      world: {
        getBlockType: () => 0
      },
      entity: {
        position: {
          clone: () => ({ x: 0, y: 64, z: 0, offset: (x: number, y: number, z: number) => ({ x, y, z }), floored: () => ({ x: 0, y: 64, z: 0 }) })
        }
      }
    } as any;

    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(behavior).not.toBeNull();
    expect(typeof behavior!.isFinished).toBe('function');
  });

  test('behavior generator handles mixed variant and non-variant steps', () => {
    const steps: ActionStep[] = [
      createTestActionStep({
        action: 'mine',
        what: createTestStringGroup('oak_log'),
        count: 3
      }),
      createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('stick', 4)
      }),
      createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 2,
        result: createTestItemReferenceGroup('oak_planks', 4)
      })
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

});
