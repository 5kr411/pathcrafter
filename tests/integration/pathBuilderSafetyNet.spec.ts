import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { ActionStep } from '../../action_tree/types';
import { createTestActionStep, createTestStringGroup, createTestItemReferenceGroup } from '../testHelpers';
import { getItemCountInInventory } from '../../utils/inventory';

jest.mock('../../utils/inventory');
const mockGetCount = getItemCountInInventory as jest.MockedFunction<typeof getItemCountInInventory>;

// Replace ALL handlers with a stub that finishes immediately and delivers nothing.
// This simulates a forgetful new behavior: it doesn't set stepSucceeded=false even
// though it produced no inventory delta.
jest.mock('../../behavior_generator/mine', () => ({
  canHandle: jest.fn(() => true),
  computeTargetsForMine: jest.fn(() => ({})),
  create: jest.fn(() => ({
    isFinished: () => true,
    onStateEntered: jest.fn(),
    onStateExited: jest.fn()
  }))
}));

jest.mock('../../behavior_generator/craftInventory', () => ({
  canHandle: jest.fn(() => false),
  create: jest.fn()
}));
jest.mock('../../behavior_generator/craftTable', () => ({ canHandle: jest.fn(() => false), create: jest.fn() }));
jest.mock('../../behavior_generator/craftVariant', () => ({ canHandle: jest.fn(() => false), create: jest.fn() }));
jest.mock('../../behavior_generator/smelt', () => ({ canHandle: jest.fn(() => false), create: jest.fn() }));
jest.mock('../../behavior_generator/hunt', () => ({ canHandle: jest.fn(() => false), create: jest.fn() }));
jest.mock('../../behavior_generator/mineOneOf', () => ({ canHandle: jest.fn(() => false), create: jest.fn() }));
jest.mock('../../behavior_generator/mineAnyOf', () => ({ canHandle: jest.fn(() => false), create: jest.fn() }));

describe('PathBuilder inventory-delta safety net', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCount.mockReturnValue(0);   // baseline 0 and stays 0 -> shortfall
  });

  it('aborts plan when a step finishes without delivering its declared output', async () => {
    const bot = {
      version: '1.21.1',
      inventory: { items: () => [], slots: [] },
      world: {},
      entity: { position: { clone: () => ({}) } }
    } as any;

    const path: ActionStep[] = [
      createTestActionStep({
        action: 'mine',
        what: createTestStringGroup('oak_log'),
        targetItem: createTestStringGroup('oak_log'),
        count: 3
      }),
      createTestActionStep({
        action: 'craft',
        what: createTestStringGroup('inventory'),
        count: 1,
        result: createTestItemReferenceGroup('oak_planks', 4)
      })
    ];

    let onFinishedSuccess: boolean | null = null;
    const sm = buildStateMachineForPath(bot, path, (success: boolean) => { onFinishedSuccess = success; });

    sm.onStateEntered();
    sm.update();
    // Step 0 finishes immediately. The safety net stamps firstFinishedAt on
    // the first update where isFinished()=true, then waits 250ms before
    // declaring shortfall. Drive the loop: stamp -> sleep 300ms -> abort.
    sm.update();
    await new Promise(r => setTimeout(r, 300));
    sm.update();
    sm.update();

    expect(onFinishedSuccess).toBe(false);
  });

  it('does not abort when the step delivers its declared output', async () => {
    // Baseline is 0 at step entry; after 300ms of "mining" the bot has 5 logs.
    // Delivered = 5 - 0 = 5 >= required 3, so the safety net releases.
    let oakLogCount = 0;
    mockGetCount.mockImplementation((_: any, name: string) =>
      name === 'oak_log' ? oakLogCount : 0
    );

    const bot = {
      version: '1.21.1',
      inventory: { items: () => [], slots: [] },
      world: {},
      entity: { position: { clone: () => ({}) } }
    } as any;

    const path: ActionStep[] = [
      createTestActionStep({
        action: 'mine',
        what: createTestStringGroup('oak_log'),
        targetItem: createTestStringGroup('oak_log'),
        count: 3
      })
    ];

    let onFinishedSuccess: boolean | null = null;
    const sm = buildStateMachineForPath(bot, path, (success: boolean) => { onFinishedSuccess = success; });

    sm.onStateEntered();
    sm.update();
    // Same loop as the shortfall case: stamp firstFinishedAt, sleep 300ms,
    // safety-net check passes, final-exit fires.
    sm.update();
    // Simulate the mining behavior having delivered 5 logs by the time the
    // safety-net grace window elapses.
    oakLogCount = 5;
    await new Promise(r => setTimeout(r, 300));
    sm.update();
    sm.update();

    expect(onFinishedSuccess).toBe(true);
  });
});
