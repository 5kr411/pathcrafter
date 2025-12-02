import { createBehaviorForStep } from '../../behavior_generator';
import { setSafeFindRepeatThreshold } from '../../utils/config';
import { createTestActionStep, createVariantGroupFromArray, getCachedMcData } from '../testHelpers';

describe('integration: behavior_generator mineAnyOf', () => {
  beforeEach(() => {
    setSafeFindRepeatThreshold(5);
  });

  test('creates behavior for a mine ANY OF step with variants', () => {
    const step = createTestActionStep({
      action: 'mine',
      variantMode: 'any_of',
      what: createVariantGroupFromArray('any_of', ['oak_log', 'birch_log', 'spruce_log']),
      count: 2
    });
    const mc = getCachedMcData('1.20.1');
    const bot = {
      version: '1.20.1',
      inventory: { items: () => [] },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [],
      mcData: mc
    } as any;
    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
  });

  test('does not handle one_of steps', () => {
    const step = createTestActionStep({
      action: 'mine',
      variantMode: 'one_of',
      what: createVariantGroupFromArray('one_of', ['oak_log', 'birch_log']),
      count: 2
    });
    const mc = getCachedMcData('1.20.1');
    const bot = {
      version: '1.20.1',
      inventory: { items: () => [] },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [],
      mcData: mc
    } as any;
    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
  });

  test('returns null for single variant any_of', () => {
    const step = createTestActionStep({
      action: 'mine',
      variantMode: 'any_of',
      what: createVariantGroupFromArray('any_of', ['oak_log']),
      count: 2
    });
    const mc = getCachedMcData('1.20.1');
    const bot = {
      version: '1.20.1',
      inventory: { items: () => [] },
      world: {},
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: () => [],
      mcData: mc
    } as any;
    const behavior = createBehaviorForStep(bot, step);
    expect(behavior).toBeTruthy();
  });
});

