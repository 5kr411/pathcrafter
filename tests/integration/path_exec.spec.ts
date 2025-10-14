import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';
import { createFakeBot } from '../utils/fakeBot';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

describe('integration: path_exec with harness', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('executes short path and calls onFinished', async () => {
    const bot = createFakeBot();
    const path: ActionStep[] = [
      createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), targetItem: createTestStringGroup('oak_log'), count: 1 }),
      createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4) })
    ];
    const finished = jest.fn();
    const sm = buildStateMachineForPath(bot as any, path, finished);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, sm, { maxMs: 3000, stepMs: 50 });
    });

    expect(finished).toHaveBeenCalled();
  });
});


