import { ensureInventoryRoom } from '../../utils/inventoryGate';

function mkBot(freeSlots: number, handle?: any): any {
  const slots: any[] = new Array(46).fill(null);
  for (let i = 0; i < 36 - freeSlots; i++) slots[9 + i] = { name: 'dirt', count: 64, type: 3 };
  const bot: any = {
    inventory: { slots, items: () => slots.filter(Boolean) },
    entity: { position: { x: 0, y: 64, z: 0 } }
  };
  if (handle) {
    bot.__reactiveBehaviors = { inventoryManagement: handle };
  }
  return bot;
}

function mkHandle(overrides: Partial<{
  buildMachine: jest.Mock;
  getConfig: jest.Mock;
}> = {}): any {
  return {
    buildMachine: overrides.buildMachine ?? jest.fn(),
    getConfig: overrides.getConfig ?? jest.fn().mockReturnValue({
      reactiveThreshold: 3,
      preGateThreshold: 2,
      cooldownMs: 30_000,
      getTargets: () => []
    })
  };
}

describe('ensureInventoryRoom', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('resolves immediately when freeSlots >= minFreeSlots', async () => {
    const buildMachine = jest.fn();
    const handle = mkHandle({ buildMachine });
    const bot = mkBot(5, handle);
    await ensureInventoryRoom(bot, 2);
    expect(buildMachine).not.toHaveBeenCalled();
  });

  it('invokes machine.run() when freeSlots < minFreeSlots', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const buildMachine = jest.fn().mockReturnValue({ run, stateMachine: {}, droppedCount: () => 0 });
    const handle = mkHandle({ buildMachine });
    const bot = mkBot(1, handle);
    await ensureInventoryRoom(bot, 2);
    expect(buildMachine).toHaveBeenCalledWith(bot);
    expect(run).toHaveBeenCalled();
  });

  it('resolves without throwing when machine is null (no candidates)', async () => {
    const buildMachine = jest.fn().mockReturnValue(null);
    const handle = mkHandle({ buildMachine });
    const bot = mkBot(0, handle);
    await expect(ensureInventoryRoom(bot, 2)).resolves.toBeUndefined();
  });

  it('resolves without throwing when machine.run() rejects', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    const buildMachine = jest.fn().mockReturnValue({ run, stateMachine: {}, droppedCount: () => 0 });
    const handle = mkHandle({ buildMachine });
    const bot = mkBot(1, handle);
    await expect(ensureInventoryRoom(bot, 2)).resolves.toBeUndefined();
  });

  it('resolves immediately when freeSlots equals minFreeSlots (boundary)', async () => {
    const buildMachine = jest.fn();
    const handle = mkHandle({ buildMachine });
    const bot = mkBot(2, handle);
    await ensureInventoryRoom(bot, 2);
    expect(buildMachine).not.toHaveBeenCalled();
  });

  it('is a no-op when no handle is attached to the bot', async () => {
    const bot = mkBot(0); // no handle attached
    await expect(ensureInventoryRoom(bot, 2)).resolves.toBeUndefined();
    // no throw, no error — the gate degrades gracefully
  });

  it('uses handle.getConfig().preGateThreshold when minFreeSlots is omitted', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const buildMachine = jest.fn().mockReturnValue({ run, stateMachine: {}, droppedCount: () => 0 });
    const getConfig = jest.fn().mockReturnValue({
      reactiveThreshold: 3,
      preGateThreshold: 5, // want at least 5 free slots
      cooldownMs: 30_000,
      getTargets: () => []
    });
    const handle = mkHandle({ buildMachine, getConfig });
    const bot = mkBot(3, handle); // only 3 free, below 5 threshold
    await ensureInventoryRoom(bot); // no explicit minFreeSlots
    expect(buildMachine).toHaveBeenCalledWith(bot);
    expect(run).toHaveBeenCalled();
  });
});
