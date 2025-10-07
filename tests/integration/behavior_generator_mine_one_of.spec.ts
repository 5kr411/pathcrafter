import { createBehaviorForStep } from '../../behavior_generator';
import { setSafeFindRepeatThreshold } from '../../utils/config';
import { createTestActionStep, createTestStringGroup } from '../testHelpers';

describe('integration: behavior_generator mineOneOf', () => {
  beforeEach(() => {
    setSafeFindRepeatThreshold(5);
  });

  test('creates behavior for a mine OR step with oneOfCandidates', () => {
    const step = createTestActionStep({
      action: 'mine',
      what: createTestStringGroup('oak_log'),
      count: 2
    });
    const mc = require('minecraft-data')('1.20.1');
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

