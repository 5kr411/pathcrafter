import createCraftNoTableState from '../../behaviors/behaviorCraftNoTable';
import { runWithFakeClock, withLoggerSpy } from '../utils/stateMachineRunner';

// Provide minimal EventEmitter-capable bot for BotStateMachine
import { EventEmitter } from 'events';

function makeBot(overrides: Partial<any> = {}): any {
  const inv: any = { slots: new Array(46).fill(null), firstEmptyInventorySlot: () => inv.slots.findIndex((s: any, i: number) => !s && i >= 9) };
  const bot: any = new EventEmitter();
  Object.assign(bot, {
    version: '1.20.1',
    inventory: inv,
    recipesFor: (_itemId: number) => [{ requiresTable: false, result: { count: 4 }, delta: [] }],
    craft: jest.fn().mockResolvedValue(undefined),
    moveSlotItem: jest.fn().mockResolvedValue(undefined)
  });
  return { ...bot, ...overrides };
}

describe('unit: behaviorCraftNoTable', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('success: crafts item and exits', async () => {
    const bot = makeBot();
    // getItemCountInInventory relies on inventory contents; simulate post-craft increase
    const counts: Record<string, number> = { stick: 0 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });
    (bot.craft as jest.Mock).mockImplementation(async () => { counts.stick += 4; });

    const targets = { itemName: 'stick', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
  });

  test('timeout: no craft completion within 20s', async () => {
    const bot = makeBot();
    const counts: Record<string, number> = { stick: 0 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });
    (bot.craft as jest.Mock).mockImplementation(async () => { /* do nothing */ });

    const targets = { itemName: 'stick', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 21000, stepMs: 250, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
  });

  test('failure: missing recipe or ingredients', async () => {
    const bot = makeBot({ recipesFor: () => [] });
    const counts: Record<string, number> = { stick: 0 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });

    const targets = { itemName: 'stick', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
  });

  test('consecutive crafts: does not short-circuit when item already in inventory', async () => {
    // Simulates the bug: planner generates two "craft 4 planks" steps.
    // Step 1 produces 4 planks. Step 2 must produce 4 MORE, not exit early.
    const bot = makeBot();
    const counts: Record<string, number> = { spruce_planks: 4 }; // Already have 4 from step 1
    const invSpy = jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });
    (bot.craft as jest.Mock).mockImplementation(async () => { counts.spruce_planks += 4; });

    const targets = { itemName: 'spruce_planks', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
    // Must have actually crafted, not short-circuited
    expect(bot.craft).toHaveBeenCalled();
    expect(counts.spruce_planks).toBe(8);
    invSpy.mockRestore();
  });
});


