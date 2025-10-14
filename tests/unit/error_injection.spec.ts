import { _internals as buildInternals } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';

jest.mock('../../behavior_generator/mine', () => ({
  canHandle: () => true,
  create: () => { throw new Error('mine create failed'); }
}));

jest.mock('../../behavior_generator/mineOneOf', () => ({
  canHandle: () => { throw new Error('mineOneOf canHandle failed'); },
  create: () => null
}));

jest.mock('../../behavior_generator/mineAnyOf', () => ({
  canHandle: () => false,
  create: () => null
}));

jest.mock('../../behavior_generator/smelt', () => ({
  canHandle: () => { throw new Error('smelt canHandle failed'); },
  create: () => null
}));

jest.mock('../../behavior_generator/craftInventory', () => ({
  canHandle: () => { throw new Error('craftInventory canHandle failed'); },
  create: () => null
}));

jest.mock('../../behavior_generator/craftTable', () => ({
  canHandle: () => { throw new Error('craftTable canHandle failed'); },
  create: () => null
}));

jest.mock('../../behavior_generator/craftVariant', () => ({
  canHandle: () => { throw new Error('craftVariant canHandle failed'); },
  create: () => null
}));

describe('unit: error injection in handlers', () => {
  test('createStateForStep falls through and returns a safe finished state', () => {
    const bot = {} as any;
    const step = { action: 'mine', what: { variants: [{ value: 'oak_log' }] } } as unknown as ActionStep;
    const st = buildInternals.createStateForStep(bot, step, {} as any);
    expect(st).toBeTruthy();
    expect(typeof st.isFinished).toBe('function');
    expect(st.isFinished()).toBe(true);
  });
});
