import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';
import { createFakeBot } from '../utils/fakeBot';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

// Mock the craft and mine generators to return simple states that finish immediately.
// This test is about transition ordering, not individual step behavior.
function makeSimpleState() {
  let finished = false;
  return {
    active: false,
    onStateEntered() { this.active = true; finished = true; },
    onStateExited() { this.active = false; },
    isFinished: () => finished,
    update() {}
  };
}

jest.mock('../../behavior_generator/craftInventory', () => ({
  canHandle: (step: any) => step?.action === 'craft' && step?.what?.variants?.some((v: any) => v.value === 'inventory'),
  create: () => makeSimpleState()
}));

jest.mock('../../behavior_generator/mine', () => ({
  canHandle: (step: any) => step?.action === 'mine',
  create: () => makeSimpleState()
}));

// The PathBuilder safety net checks inventory delta against the step's declared
// output. This unit test mocks the per-step behaviors as no-ops, so we also
// stub the inventory helper: it returns 0 at step entry (baseline) and then
// jumps to 999 once the step is "running", so the delta is always large enough
// to satisfy the safety net. This keeps the test focused on transition
// ordering rather than delivery verification.
jest.mock('../../utils/inventory', () => {
  const actual = jest.requireActual('../../utils/inventory');
  let calls = 0;
  return {
    ...actual,
    getItemCountInInventory: jest.fn().mockImplementation(() => {
      calls += 1;
      // First call per step = baseline (return 0); subsequent = post-step (999).
      // Steps run sequentially, so alternating odd/even mirrors entry/check.
      return calls % 2 === 1 ? 0 : 999;
    })
  };
});

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
