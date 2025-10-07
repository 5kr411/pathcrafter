import * as genSmelt from '../../behavior_generator/smelt';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';

describe('unit: behavior_generator smelt mapping', () => {
  test('computeTargetsForSmelt extracts result/input/fuel/count', () => {
    const step = createTestActionStep({ 
      action: 'smelt', 
      what: createTestStringGroup('furnace'), 
      count: 3, 
      input: createTestItemReferenceGroup('raw_iron', 1), 
      result: createTestItemReferenceGroup('iron_ingot', 1), 
      fuel: createTestStringGroup('coal')
    });
    const t = genSmelt.computeTargetsForSmelt(step);
    expect(t).toBeTruthy();
    expect(t!.itemName).toBe('iron_ingot');
    expect(t!.amount).toBe(3);
    expect(t!.inputName).toBe('raw_iron');
    expect(t!.fuelName).toBe('coal');
  });
});

