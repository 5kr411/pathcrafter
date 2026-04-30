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

  test('retry: craft fails once then succeeds on retry', async () => {
    const bot = makeBot();
    const counts: Record<string, number> = { stick: 0 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });
    let callCount = 0;
    (bot.craft as jest.Mock).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('inventory desync');
      }
      counts.stick += 4;
    });

    const targets = { itemName: 'stick', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
    expect(bot.craft).toHaveBeenCalledTimes(2);
    expect(counts.stick).toBe(4);
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

  test('inventory sync race: bot.craft resolves before items show up in inventory', async () => {
    // Reproduces the zero-delta false-success bug: bot.craft's promise
    // resolves before the server's setSlot packets land. The post-craft
    // count reads 0, the behavior used to declare failure ("Crafting did
    // not increase item count") and the executor would wander+retry.
    // Fix: state machine must keep polling until inventory satisfies the
    // request or the 20s timeout elapses.
    const bot = makeBot();
    const counts: Record<string, number> = { oak_planks: 0 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });
    (bot.craft as jest.Mock).mockImplementation(async () => {
      // Resolve immediately, but defer the inventory update — simulating
      // the real race where setSlot packets arrive ~hundreds of ms later.
      setTimeout(() => { counts.oak_planks = 4; }, 500);
    });

    const targets = { itemName: 'oak_planks', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
    expect(counts.oak_planks).toBe(4);
    expect((sm as any).stepSucceeded).not.toBe(false);
  });

  test('inventory mid-flight: items() reads stale 0 then recovers (negative delta)', async () => {
    // Reproduces "0/16 torch (started with 8)": bot has 8 torches, crafts
    // 8 more (target 16). Briefly after bot.craft resolves, items() returns
    // 0 because in-flight setSlot packets have temporarily nulled the slot.
    // The behavior should not declare failure on this read — wait for sync.
    const bot = makeBot();
    let inventoryFlight = false;
    const counts: Record<string, number> = { torch: 8 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      if (inventoryFlight && name === 'torch') return 0;
      return counts[name] || 0;
    });
    (bot.craft as jest.Mock).mockImplementation(async () => {
      inventoryFlight = true;
      setTimeout(() => {
        inventoryFlight = false;
        counts.torch = 16;
      }, 500);
    });

    const targets = { itemName: 'torch', amount: 8 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
    expect(counts.torch).toBe(16);
    expect((sm as any).stepSucceeded).not.toBe(false);
  });

  test('clearCraftingSlots: each move uses a fresh empty slot, no collisions', async () => {
    // Reproduces a race where clearCraftingSlots sampled
    // bot.inventory.firstEmptyInventorySlot() synchronously for all four
    // crafting slots, before any move had finished server-side. All moves
    // resolved to the same destination, and later moves clobbered earlier
    // ones (or got rejected). Sequential awaits force a fresh sample
    // between moves.
    const bot = makeBot();
    bot.inventory.slots[1] = { name: 'oak_log', count: 1 };
    bot.inventory.slots[3] = { name: 'stick', count: 1 };
    bot.inventory.slots[4] = { name: 'coal', count: 1 };
    bot.inventory.firstEmptyInventorySlot = () =>
      bot.inventory.slots.findIndex((s: any, i: number) => !s && i >= 9);
    // Defer the slot update by one microtask, simulating a server roundtrip
    // — the synchronous (broken) version of clearCraftingSlots would not
    // see the updated slots between iterations.
    (bot.moveSlotItem as jest.Mock).mockImplementation((src: number, dst: number) =>
      Promise.resolve().then(() => {
        bot.inventory.slots[dst] = bot.inventory.slots[src];
        bot.inventory.slots[src] = null;
      })
    );

    const counts: Record<string, number> = { stick: 0 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });
    (bot.craft as jest.Mock).mockImplementation(async () => { counts.stick = 4; });

    const targets = { itemName: 'stick', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 3000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
    const dests = (bot.moveSlotItem as jest.Mock).mock.calls.map((c: any[]) => c[1]);
    expect(dests.length).toBeGreaterThanOrEqual(3);
    expect(new Set(dests).size).toBe(dests.length); // all distinct
  });

  test('drop during prep: baseline re-captured so success not turned into timeout', async () => {
    // Reproduces: ensureInventoryRoom may drop the target item to free
    // slots. baselineCount used to be sampled before that drop, so the
    // state machine polled `baseline + amount` which was unreachable after
    // the drop, causing a 20s timeout on what was actually a successful
    // craft. Re-baselining after the gate runs makes the polling target
    // reflect post-drop reality.
    const bot = makeBot();
    const counts: Record<string, number> = { torch: 8 };
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation((...args: any[]) => {
      const name = String(args[1]);
      return counts[name] || 0;
    });
    jest.spyOn(require('../../utils/inventoryGate'), 'ensureInventoryRoom').mockImplementation(async () => {
      counts.torch = 0; // gate dropped all the torches
    });
    (bot.craft as jest.Mock).mockImplementation(async () => { counts.torch += 8; });

    const targets = { itemName: 'torch', amount: 8 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      // Allow up to 22s of fake time so the broken (timeout) path would
      // surface as stepSucceeded=false. Fixed path exits within ~150ms.
      await runWithFakeClock(bot, sm, { maxMs: 22000, stepMs: 250, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
    expect((sm as any).stepSucceeded).not.toBe(false);
    expect(counts.torch).toBe(8);
  });

  test('real failure: missing ingredients still fails fast (no 20s wait)', async () => {
    // Negative coverage for the fix: a real failure (missing ingredients)
    // must still bail out quickly via stepSucceeded=false, not stall waiting
    // for inventory that will never arrive.
    const bot = makeBot({
      // Recipe says we need 1 oak_log per plank, but inventory has none.
      recipesFor: () => [{ requiresTable: false, result: { count: 4 }, delta: [{ id: 1, count: -1 }] }]
    });
    // Mock mcData lookup so the delta points at "oak_log" we don't have.
    const mcData = require('minecraft-data');
    const realData = mcData('1.20.1');
    jest.spyOn(require('../../utils/inventory'), 'getItemCountInInventory').mockImplementation(() => 0);

    const targets = { itemName: 'oak_planks', amount: 4 } as any;
    const sm = createCraftNoTableState(bot, targets);

    await withLoggerSpy(async () => {
      await runWithFakeClock(bot, sm, { maxMs: 1000, stepMs: 50, directNested: true });
    });

    expect((sm as any).isFinished()).toBe(true);
    expect((sm as any).stepSucceeded).toBe(false);
    expect(bot.craft).not.toHaveBeenCalled();
    // Quiet ts/eslint about unused mc-data sanity import
    void realData;
  });
});


