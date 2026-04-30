import createSmeltState from '../../behaviors/behaviorSmelt';

jest.mock('../../behaviors/behaviorPlaceNear', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((_bot: any, targets: any) => ({
    isFinished: () => true,
    onStateEntered: jest.fn(),
    onStateExited: jest.fn(),
    _targets: targets
  }))
}));

jest.mock('../../behaviors/behaviorBreakAtPosition', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    isFinished: () => true,
    onStateEntered: jest.fn(),
    onStateExited: jest.fn()
  }))
}));

jest.mock('../../behaviors/behaviorSafeFollowEntity', () => ({
  BehaviorSafeFollowEntity: jest.fn().mockImplementation(() => ({
    isFinished: () => false,
    onStateEntered: jest.fn(),
    onStateExited: jest.fn()
  }))
}));

jest.mock('../../utils/inventory', () => ({
  getItemCountInInventory: jest.fn(() => 0)
}));

const inv = require('../../utils/inventory');
const placeNearModule = require('../../behaviors/behaviorPlaceNear');

function makeBot(overrides: Partial<any> = {}) {
  return {
    version: '1.21.1',
    inventory: { items: () => [{ name: 'furnace', count: 1 }] },
    clearControlStates: jest.fn(),
    blockAt: jest.fn(() => ({ name: 'furnace' })),
    openFurnace: jest.fn(),
    ...overrides
  };
}

describe('behaviorSmelt - stepSucceeded contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    inv.getItemCountInInventory.mockReturnValue(0);
  });

  it('flags failure when itemName is missing', () => {
    const sm = createSmeltState(makeBot(), { itemName: '', amount: 1, inputName: 'iron_ore' } as any);
    sm.onStateEntered();
    sm.update();
    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('missing_item_or_input');
    sm.onStateExited();
  });

  it('flags failure when furnace placement fails', () => {
    const sm = createSmeltState(makeBot(), {
      itemName: 'iron_ingot', amount: 1, inputName: 'iron_ore'
    });
    sm.onStateEntered();
    sm.update();          // enter -> place
    sm.update();          // place -> exit (failed)
    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('place_furnace_failed:iron_ingot');
    sm.onStateExited();
  });

  // No-input / no-fuel short-circuits go through the break-and-pickup path so
  // the furnace is recovered. We assert the failure flag survives that path.
  it('flags failure when no input material in inventory (still recovers furnace)', async () => {
    placeNearModule.default.mockImplementation((_bot: any, targets: any) => ({
      isFinished: () => true,
      onStateEntered: jest.fn(() => {
        targets.placedConfirmed = true;
        targets.placedPosition = { x: 0, y: 64, z: 0 };
      }),
      onStateExited: jest.fn(),
      _targets: targets
    }));
    inv.getItemCountInInventory.mockImplementation((_: any, name: string) =>
      name === 'iron_ore' ? 0 : (name === 'coal' ? 8 : 0)
    );

    const sm = createSmeltState(makeBot(), {
      itemName: 'iron_ingot', amount: 1, inputName: 'iron_ore', fuelName: 'coal'
    });
    sm.onStateEntered();
    sm.update();
    sm.update();
    await Promise.resolve();
    sm.update();
    sm.update();
    sm.update();

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('smelt_no_input:iron_ore');
    sm.onStateExited();
  });

  it('flags shortfall when smelt completed but delivered < wantCount', async () => {
    placeNearModule.default.mockImplementation((_bot: any, targets: any) => ({
      isFinished: () => true,
      onStateEntered: jest.fn(() => {
        targets.placedConfirmed = true;
        targets.placedPosition = { x: 0, y: 64, z: 0 };
      }),
      onStateExited: jest.fn()
    }));

    let inventoryReturn = 0;
    inv.getItemCountInInventory.mockImplementation((_: any, name: string) => {
      if (name === 'iron_ingot') return inventoryReturn;
      if (name === 'iron_ore') return 4;
      if (name === 'coal') return 8;
      if (name === 'furnace') return 1;
      return 0;
    });

    // openFurnace rejects so the smelt loop short-circuits via catch/finally
    // (smeltDone = true, no smeltAbortReason). This simulates a smelt that
    // "completed" but delivered fewer items than wantCount.
    const bot = makeBot({
      inventory: {
        items: () => [
          { name: 'furnace', count: 1 },
          { name: 'iron_ore', count: 4 },
          { name: 'coal', count: 8 }
        ]
      },
      openFurnace: jest.fn(async () => {
        // Bump inventoryReturn to simulate partial smelt before failure
        inventoryReturn = 2;
        throw new Error('mocked: smelt loop ends');
      })
    });

    const sm = createSmeltState(bot, {
      itemName: 'iron_ingot', amount: 4, inputName: 'iron_ore', fuelName: 'coal'
    });
    sm.onStateEntered();
    sm.update(); // enter -> place
    sm.update(); // place -> smelt (triggers smeltRun.onStateEntered async)
    // Wait for the async smelt routine to complete (catch + finally)
    await new Promise(r => setTimeout(r, 10));
    sm.update(); // smelt -> break
    sm.update(); // break -> wait
    // hasPickedUpFurnace requires furnaceCountBeforeBreak < furnace count.
    // furnace mock returns 1 throughout, so hasPickedUpFurnace is false
    // at smeltToBreak time (sets furnaceCountBeforeBreak=1) and stays false.
    // Force the wait timeout path by advancing time and bumping the
    // furnace count to simulate auto-pickup.
    inv.getItemCountInInventory.mockImplementation((_: any, name: string) => {
      if (name === 'iron_ingot') return inventoryReturn;
      if (name === 'iron_ore') return 4;
      if (name === 'coal') return 8;
      if (name === 'furnace') return 2; // auto-picked up
      return 0;
    });
    await new Promise(r => setTimeout(r, 1100));
    sm.update(); // wait -> exit (picked up)

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('smelt_shortfall:iron_ingot:2/4');
    sm.onStateExited();
  });
});
