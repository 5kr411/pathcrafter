import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';
import { createFakeBot } from '../utils/fakeBot';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

describe('unit: buildStateMachineForPath transitions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('emits ordered step transitions and final-exit triggers onFinished', async () => {
    const bot = createFakeBot();
    const path: ActionStep[] = [
      createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), targetItem: createTestStringGroup('oak_log'), count: 1 }),
      createTestActionStep({ action: 'craft', what: createTestStringGroup('inventory'), count: 1, result: createTestItemReferenceGroup('oak_planks', 4) }),
    ];

    const finished = jest.fn();
    const machine = buildStateMachineForPath(bot as any, path, finished);

    await withLoggerSpy(async (logger) => {
      await runWithFakeClock(bot as any, machine, { maxMs: 2000, stepMs: 50 });
      const infos = (logger as any).info as jest.Mock;
      const messages = infos.mock.calls.map((c: any[]) => String(c[0]));
      expect(messages.some((m: string) => m.includes('PathBuilder: step 0 -> mine'))).toBe(true);
      // what is a VariantGroup object in logs; just assert craft step logged
      expect(messages.some((m: string) => m.includes('PathBuilder: step 1 -> craft'))).toBe(true);
      expect(messages.some((m: string) => m.includes('PathBuilder: final-exit'))).toBe(true);
    });

    expect(finished).toHaveBeenCalled();
  });

  test('unknown action creates a finished no-op state and still reaches final exit', async () => {
    const bot = createFakeBot();
    const path: ActionStep[] = [
      createTestActionStep({ action: 'unknown' as any, what: createTestStringGroup('foo'), count: 1 }),
      createTestActionStep({ action: 'mine', what: createTestStringGroup('oak_log'), targetItem: createTestStringGroup('oak_log'), count: 1 })
    ];

    const finished = jest.fn();
    const machine = buildStateMachineForPath(bot as any, path, finished);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot as any, machine, { maxMs: 1500, stepMs: 50 });
    });

    expect(finished).toHaveBeenCalled();
  });
});


