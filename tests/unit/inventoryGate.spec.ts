import { ensureInventoryRoom } from '../../utils/inventoryGate';

jest.mock('../../bots/collector/reactive_behaviors/inventory_management_behavior', () => ({
  __esModule: true,
  buildInventoryManagementMachine: jest.fn()
}));

function mkBot(freeSlots: number): any {
  const slots: any[] = new Array(46).fill(null);
  for (let i = 0; i < 36 - freeSlots; i++) slots[9 + i] = { name: 'dirt', count: 64, type: 3 };
  return {
    inventory: { slots, items: () => slots.filter(Boolean) },
    entity: { position: { x: 0, y: 64, z: 0 } }
  };
}

describe('ensureInventoryRoom', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('resolves immediately when freeSlots >= minFreeSlots', async () => {
    const bot = mkBot(5);
    await ensureInventoryRoom(bot, 2);
    const mod = require('../../bots/collector/reactive_behaviors/inventory_management_behavior');
    expect(mod.buildInventoryManagementMachine).not.toHaveBeenCalled();
  });

  it('invokes machine.run() when freeSlots < minFreeSlots', async () => {
    const bot = mkBot(1);
    const run = jest.fn().mockResolvedValue(undefined);
    const mod = require('../../bots/collector/reactive_behaviors/inventory_management_behavior');
    mod.buildInventoryManagementMachine.mockReturnValue({ run, stateMachine: {}, droppedCount: () => 0 });
    await ensureInventoryRoom(bot, 2);
    expect(mod.buildInventoryManagementMachine).toHaveBeenCalledWith(bot);
    expect(run).toHaveBeenCalled();
  });

  it('resolves without throwing when machine is null (no candidates)', async () => {
    const bot = mkBot(0);
    const mod = require('../../bots/collector/reactive_behaviors/inventory_management_behavior');
    mod.buildInventoryManagementMachine.mockReturnValue(null);
    await expect(ensureInventoryRoom(bot, 2)).resolves.toBeUndefined();
  });

  it('resolves without throwing when machine.run() rejects', async () => {
    const bot = mkBot(1);
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    const mod = require('../../bots/collector/reactive_behaviors/inventory_management_behavior');
    mod.buildInventoryManagementMachine.mockReturnValue({ run, stateMachine: {}, droppedCount: () => 0 });
    await expect(ensureInventoryRoom(bot, 2)).resolves.toBeUndefined();
  });
});
