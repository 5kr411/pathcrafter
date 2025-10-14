import { createBehaviorForStep } from '../../behavior_generator';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';

describe('unit: behavior_generator dispatch', () => {
  test('unknown action returns null', () => {
    const bot = {} as any;
    const behavior = createBehaviorForStep(bot, createTestActionStep({ action: 'teleport' as any, what: createTestStringGroup('nowhere'), count: 1 }));
    expect(behavior).toBeNull();
  });

  test('craft inventory action returns a behavior', () => {
    const bot = {
      version: '1.20.1',
      recipesFor: () => [],
      inventory: { slots: [], firstEmptyInventorySlot: () => 9 },
      craft: jest.fn()
    } as any;
    const step = createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('stick', 4) });
    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
    expect(typeof behavior).toBe('object');
  });
});


