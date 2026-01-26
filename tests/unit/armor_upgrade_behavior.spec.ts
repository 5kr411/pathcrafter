jest.mock('mineflayer-statemachine', () => {
  class BehaviorIdle {
    active = false;
    onStateEntered?(): void;
    onStateExited?(): void;
    update?(): void;
  }

  class BehaviorEquipItem {
    bot: any;
    targets: any;
    finished: boolean;

    constructor(bot: any, targets: any) {
      this.bot = bot;
      this.targets = targets;
      this.finished = false;
    }

    isFinished(): boolean {
      if (typeof (this.targets?.item) === 'undefined' || this.targets?.item === null) {
        return true;
      }
      return this.finished;
    }

    onStateEntered(): void {
      if (!this.targets?.item) {
        this.finished = true;
        return;
      }
      const item = this.targets.item;
      const destination = this.getDestination(item);
      this.bot.equip(item, destination).then(() => {
        if (typeof this.bot.getEquipmentDestSlot === 'function') {
          const slotIndex = this.bot.getEquipmentDestSlot(destination);
          if (Number.isInteger(slotIndex) && Array.isArray(this.bot.inventory?.slots)) {
            this.bot.inventory.slots[slotIndex] = item;
          }
        }
        if (Array.isArray(this.bot._inventoryItems)) {
          const idx = this.bot._inventoryItems.indexOf(item);
          if (idx >= 0) {
            this.bot._inventoryItems.splice(idx, 1);
          }
        }
        this.equipItemCallback();
      }).catch((err: any) => {
        this.equipItemCallback(err);
      });
    }

    onStateExited(): void {}

    equipItemCallback(err?: any): void {
      if (err) {
        // no-op, just acknowledge error for type checking
      }
      this.finished = true;
    }

    private getDestination(item: any): string {
      if (!item?.name) return 'hand';
      if (item.name === 'turtle_helmet') return 'head';
      if (item.name.endsWith('_helmet')) return 'head';
      if (item.name.endsWith('_chestplate')) return 'torso';
      if (item.name.endsWith('_leggings')) return 'legs';
      if (item.name.endsWith('_boots')) return 'feet';
      return 'hand';
    }
  }

  class StateTransition {
    parent: any;
    child: any;
    shouldTransition: () => boolean;
    onTransition?: () => void;
    name?: string;

    constructor(options: { parent: any; child: any; shouldTransition: () => boolean; onTransition?: () => void; name?: string }) {
      this.parent = options.parent;
      this.child = options.child;
      this.shouldTransition = options.shouldTransition;
      this.onTransition = options.onTransition;
      this.name = options.name;
    }
  }

  class NestedStateMachine {
    transitions: StateTransition[];
    enter: any;
    exit: any;
    current: any;

    constructor(transitions: StateTransition[], enter: any, exit: any) {
      this.transitions = transitions;
      this.enter = enter;
      this.exit = exit;
      this.current = null;
    }

    onStateEntered(): void {
      this.current = this.enter;
      if (typeof this.current?.onStateEntered === 'function') {
        this.current.onStateEntered();
      }
      this.advance();
    }

    update(): void {
      this.advance();
    }

    onStateExited(): void {
      if (typeof this.current?.onStateExited === 'function') {
        this.current.onStateExited();
      }
      this.current = null;
    }

    isFinished(): boolean {
      if (!this.exit) return false;
      return this.current === this.exit;
    }

    private advance(): void {
      let transitioned = true;
      while (transitioned) {
        transitioned = false;
        for (const transition of this.transitions) {
          if (transition.parent === this.current && transition.shouldTransition()) {
            if (typeof this.current?.onStateExited === 'function') {
              this.current.onStateExited();
            }
            if (typeof transition.onTransition === 'function') {
              transition.onTransition();
            }
            this.current = transition.child;
            if (typeof this.current?.onStateEntered === 'function') {
              this.current.onStateEntered();
            }
            transitioned = true;
            break;
          }
        }
      }
    }
  }

  return {
    BehaviorEquipItem,
    BehaviorIdle,
    StateTransition,
    NestedStateMachine
  };
});

import { armorUpgradeBehavior, resetArmorUpgradeCooldowns } from '../../bots/collector/reactive_behaviors/armor_upgrade_behavior';
import { getCachedMcData } from '../testHelpers';

const SLOT_INDEX: Record<string, number> = {
  head: 5,
  torso: 6,
  legs: 7,
  feet: 8,
  hand: 36,
  'off-hand': 45
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  const timerImpl: any = setTimeout as any;
  const fakeTimersActive = typeof jest !== 'undefined' && (!!timerImpl?.clock || (typeof jest.isMockFunction === 'function' && jest.isMockFunction(setTimeout)));
  if (fakeTimersActive) {
    if (typeof jest.advanceTimersByTime === 'function') {
      jest.advanceTimersByTime(100);
    } else if (typeof jest.runOnlyPendingTimers === 'function') {
      try {
        jest.runOnlyPendingTimers();
      } catch (_err) {
        // ignored
      }
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  await Promise.resolve();
};

const runStateMachineToCompletion = async (state: any, maxSteps: number = 6): Promise<void> => {
  const machine = state?.stateMachine;
  if (!machine) return;
  if (typeof machine.onStateEntered === 'function') {
    machine.onStateEntered();
  }
  for (let i = 0; i < maxSteps; i += 1) {
    if (typeof machine.isFinished === 'function' && machine.isFinished()) {
      break;
    }
    if (typeof machine.update === 'function') {
      machine.update();
    }
    // eslint-disable-next-line no-await-in-loop
    await flush();
  }
};

function createBot(options: {
  items: any[];
  equipped?: Record<'head' | 'torso' | 'legs' | 'feet', any | null>;
  registryItems?: Record<number, { maxDurability: number }>;
}) {
  const { items, equipped, registryItems } = options;
  const slots = new Array(46).fill(null);

  if (equipped) {
    for (const [slot, item] of Object.entries(equipped)) {
      if (!item) continue;
      const index = SLOT_INDEX[slot];
      if (index !== undefined) {
        slots[index] = item;
      }
    }
  }

  const bot: any = {
    version: '1.20.1',
    inventory: {
      items: jest.fn(() => bot._inventoryItems),
      slots
    },
    registry: { items: registryItems ?? {} },
    getEquipmentDestSlot: jest.fn((slot: string) => SLOT_INDEX[slot] ?? 36),
    equip: jest.fn().mockResolvedValue(undefined),
    safeChat: jest.fn(),
    chat: jest.fn()
  };

  bot._inventoryItems = Array.isArray(items) ? [...items] : [];

  return bot;
}

describe('unit: armor_upgrade_behavior', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
  });

  beforeEach(() => {
    resetArmorUpgradeCooldowns();
    jest.useRealTimers();
  });

  afterEach(() => {
    resetArmorUpgradeCooldowns();
    jest.useRealTimers();
  });

  test('should not activate when no armor upgrades available', () => {
    const bot = createBot({ items: [] });
    const result = armorUpgradeBehavior.shouldActivate(bot);
    expect(result).toBe(false);
  });

  test('activates and equips better helmet', async () => {
    const leatherHelmet = {
      name: 'leather_helmet',
      type: mcData.itemsByName.leather_helmet.id,
      maxDurability: mcData.itemsByName.leather_helmet.maxDurability,
      durabilityUsed: 0
    };

    const ironHelmet = {
      name: 'iron_helmet',
      type: mcData.itemsByName.iron_helmet.id,
      maxDurability: mcData.itemsByName.iron_helmet.maxDurability,
      durabilityUsed: 0
    };

    const bot = createBot({
      items: [ironHelmet],
      equipped: { head: leatherHelmet, torso: null, legs: null, feet: null },
      registryItems: {
        [leatherHelmet.type]: { maxDurability: leatherHelmet.maxDurability },
        [ironHelmet.type]: { maxDurability: ironHelmet.maxDurability }
      }
    });

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    bot.unequip = jest.fn().mockResolvedValue(undefined);
    bot.equip = jest.fn().mockImplementation((item: any, destination: string) => {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      bot.inventory.slots[slotIndex] = item;
      const idx = bot._inventoryItems.indexOf(item);
      if (idx >= 0) {
        bot._inventoryItems.splice(idx, 1);
      }
      return Promise.resolve();
    });

    const state = await armorUpgradeBehavior.createState(bot);
    expect(state).not.toBeNull();

    await runStateMachineToCompletion(state);

    expect(bot.unequip).toHaveBeenCalledWith('head');
    expect(bot.equip).toHaveBeenCalledWith(ironHelmet, 'head');
    expect(state?.wasSuccessful?.()).toBe(true);
    expect(bot.safeChat).toHaveBeenCalledWith('equipped iron_helmet');
  });

  test('upgrades to higher durability armor of same tier', async () => {
    const diamondChestplateEquipped = {
      name: 'diamond_chestplate',
      type: mcData.itemsByName.diamond_chestplate.id,
      maxDurability: mcData.itemsByName.diamond_chestplate.maxDurability,
      durabilityUsed: mcData.itemsByName.diamond_chestplate.maxDurability - 10
    };

    const diamondChestplateFresh = {
      name: 'diamond_chestplate',
      type: mcData.itemsByName.diamond_chestplate.id,
      maxDurability: mcData.itemsByName.diamond_chestplate.maxDurability,
      durabilityUsed: 0
    };

    const chainmailChestplate = {
      name: 'chainmail_chestplate',
      type: mcData.itemsByName.chainmail_chestplate.id,
      maxDurability: mcData.itemsByName.chainmail_chestplate.maxDurability,
      durabilityUsed: 0
    };

    const registryItems: Record<number, { maxDurability: number }> = {
      [diamondChestplateEquipped.type]: { maxDurability: diamondChestplateEquipped.maxDurability },
      [chainmailChestplate.type]: { maxDurability: chainmailChestplate.maxDurability }
    };

    const inventoryItems = [diamondChestplateFresh, chainmailChestplate];

    const bot = createBot({
      items: inventoryItems,
      equipped: {
        head: null,
        torso: diamondChestplateEquipped,
        legs: null,
        feet: null
      },
      registryItems
    });

    bot.unequip = jest.fn().mockResolvedValue(undefined);
    bot.equip = jest.fn().mockImplementation((item: any, destination: string) => {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      bot.inventory.slots[slotIndex] = item;
      const idx = bot._inventoryItems.indexOf(item);
      if (idx >= 0) {
        bot._inventoryItems.splice(idx, 1);
      }
      return Promise.resolve();
    });

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    const state = await armorUpgradeBehavior.createState(bot);
    expect(state).not.toBeNull();
    await runStateMachineToCompletion(state);

    expect(bot.unequip).toHaveBeenCalledWith('torso');
    expect(bot.equip).toHaveBeenCalledWith(diamondChestplateFresh, 'torso');
    expect(state?.wasSuccessful?.()).toBe(true);
    expect(bot.safeChat).toHaveBeenCalledWith('equipped diamond_chestplate');
  });

  test('waits for cooldown before reattempting same slot upgrade', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);

    const leatherHelmet = {
      name: 'leather_helmet',
      type: mcData.itemsByName.leather_helmet.id,
      maxDurability: mcData.itemsByName.leather_helmet.maxDurability,
      durabilityUsed: 0
    };

    const diamondHelmet = {
      name: 'diamond_helmet',
      type: mcData.itemsByName.diamond_helmet.id,
      maxDurability: mcData.itemsByName.diamond_helmet.maxDurability,
      durabilityUsed: 0
    };

    const netheriteHelmet = {
      name: 'netherite_helmet',
      type: mcData.itemsByName.netherite_helmet.id,
      maxDurability: mcData.itemsByName.netherite_helmet.maxDurability,
      durabilityUsed: 0
    };

    const bot = createBot({
      items: [diamondHelmet],
      equipped: { head: leatherHelmet, torso: null, legs: null, feet: null },
      registryItems: {
        [leatherHelmet.type]: { maxDurability: leatherHelmet.maxDurability },
        [diamondHelmet.type]: { maxDurability: diamondHelmet.maxDurability },
        [netheriteHelmet.type]: { maxDurability: netheriteHelmet.maxDurability }
      }
    });

    bot.unequip = jest.fn().mockResolvedValue(undefined);
    bot.equip = jest.fn().mockImplementation((item: any, destination: string) => {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      bot.inventory.slots[slotIndex] = item;
      const idx = bot._inventoryItems.indexOf(item);
      if (idx >= 0) {
        bot._inventoryItems.splice(idx, 1);
      }
      return Promise.resolve();
    });

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    const state = await armorUpgradeBehavior.createState(bot);
    expect(state).not.toBeNull();
    await runStateMachineToCompletion(state);
    expect(state?.wasSuccessful?.()).toBe(true);
    expect(bot.safeChat).toHaveBeenCalledWith('equipped diamond_helmet');

    bot._inventoryItems = [netheriteHelmet];
    bot.inventory.items = jest.fn(() => bot._inventoryItems);

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(false);

    jest.advanceTimersByTime(2000);

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    jest.useRealTimers();
  });

  test('successfully upgrades from diamond to netherite', async () => {
    const diamondHelmet = {
      name: 'diamond_helmet',
      type: mcData.itemsByName.diamond_helmet.id,
      maxDurability: mcData.itemsByName.diamond_helmet.maxDurability,
      durabilityUsed: 0
    };

    const netheriteHelmet = {
      name: 'netherite_helmet',
      type: mcData.itemsByName.netherite_helmet.id,
      maxDurability: mcData.itemsByName.netherite_helmet.maxDurability,
      durabilityUsed: 0
    };

    const bot = createBot({
      items: [netheriteHelmet],
      equipped: { head: diamondHelmet, torso: null, legs: null, feet: null },
      registryItems: {
        [diamondHelmet.type]: { maxDurability: diamondHelmet.maxDurability },
        [netheriteHelmet.type]: { maxDurability: netheriteHelmet.maxDurability }
      }
    });

    bot.unequip = jest.fn().mockResolvedValue(undefined);
    bot.equip = jest.fn().mockImplementation((item: any, destination: string) => {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      bot.inventory.slots[slotIndex] = item;
      const idx = bot._inventoryItems.indexOf(item);
      if (idx >= 0) {
        bot._inventoryItems.splice(idx, 1);
      }
      return Promise.resolve();
    });

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    const state = await armorUpgradeBehavior.createState(bot);
    expect(state).not.toBeNull();
    await runStateMachineToCompletion(state);

    expect(bot.unequip).toHaveBeenCalledWith('head');
    expect(bot.equip).toHaveBeenCalledWith(netheriteHelmet, 'head');
    expect(state?.wasSuccessful?.()).toBe(true);
    expect(bot.safeChat).toHaveBeenCalledWith('equipped netherite_helmet');
  });

  test('activates and equips shield when in inventory and offhand is empty', async () => {
    const shield = {
      name: 'shield',
      type: mcData.itemsByName.shield.id,
      maxDurability: mcData.itemsByName.shield.maxDurability,
      durabilityUsed: 0
    };

    const bot = createBot({
      items: [shield],
      equipped: { head: null, torso: null, legs: null, feet: null }
    });

    bot.equip = jest.fn().mockImplementation((item: any, destination: string) => {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      bot.inventory.slots[slotIndex] = item;
      const idx = bot._inventoryItems.indexOf(item);
      if (idx >= 0) {
        bot._inventoryItems.splice(idx, 1);
      }
      return Promise.resolve();
    });

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    const state = await armorUpgradeBehavior.createState(bot);
    expect(state).not.toBeNull();
    await runStateMachineToCompletion(state);

    expect(bot.equip).toHaveBeenCalledWith(shield, 'off-hand');
    expect(state?.wasSuccessful?.()).toBe(true);
    expect(bot.safeChat).toHaveBeenCalledWith('equipped shield');
  });

  test('does not activate for shield when shield already in offhand', () => {
    const shield = {
      name: 'shield',
      type: mcData.itemsByName.shield.id,
      maxDurability: mcData.itemsByName.shield.maxDurability,
      durabilityUsed: 0
    };

    const bot = createBot({
      items: [],
      equipped: { head: null, torso: null, legs: null, feet: null }
    });
    bot.inventory.slots[SLOT_INDEX['off-hand']] = shield;

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(false);
  });

  test('prioritizes armor upgrade over shield equip', async () => {
    const ironHelmet = {
      name: 'iron_helmet',
      type: mcData.itemsByName.iron_helmet.id,
      maxDurability: mcData.itemsByName.iron_helmet.maxDurability,
      durabilityUsed: 0
    };

    const shield = {
      name: 'shield',
      type: mcData.itemsByName.shield.id,
      maxDurability: mcData.itemsByName.shield.maxDurability,
      durabilityUsed: 0
    };

    const bot = createBot({
      items: [ironHelmet, shield],
      equipped: { head: null, torso: null, legs: null, feet: null },
      registryItems: {
        [ironHelmet.type]: { maxDurability: ironHelmet.maxDurability }
      }
    });

    bot.equip = jest.fn().mockImplementation((item: any, destination: string) => {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      bot.inventory.slots[slotIndex] = item;
      const idx = bot._inventoryItems.indexOf(item);
      if (idx >= 0) {
        bot._inventoryItems.splice(idx, 1);
      }
      return Promise.resolve();
    });

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    const state = await armorUpgradeBehavior.createState(bot);
    expect(state).not.toBeNull();
    await runStateMachineToCompletion(state);

    expect(bot.equip).toHaveBeenCalledWith(ironHelmet, 'head');
    expect(state?.wasSuccessful?.()).toBe(true);
    expect(bot.safeChat).toHaveBeenCalledWith('equipped iron_helmet');
  });

  test('shield equip respects cooldown', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);

    const shield = {
      name: 'shield',
      type: mcData.itemsByName.shield.id,
      maxDurability: mcData.itemsByName.shield.maxDurability,
      durabilityUsed: 0
    };

    const bot = createBot({
      items: [shield],
      equipped: { head: null, torso: null, legs: null, feet: null }
    });

    bot.equip = jest.fn().mockImplementation((item: any, destination: string) => {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      bot.inventory.slots[slotIndex] = item;
      const idx = bot._inventoryItems.indexOf(item);
      if (idx >= 0) {
        bot._inventoryItems.splice(idx, 1);
      }
      return Promise.resolve();
    });

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    const state = await armorUpgradeBehavior.createState(bot);
    expect(state).not.toBeNull();
    await runStateMachineToCompletion(state);
    expect(state?.wasSuccessful?.()).toBe(true);

    bot._inventoryItems = [{ ...shield }];
    bot.inventory.items = jest.fn(() => bot._inventoryItems);
    bot.inventory.slots[SLOT_INDEX['off-hand']] = null;

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(false);

    jest.advanceTimersByTime(2000);

    expect(armorUpgradeBehavior.shouldActivate(bot)).toBe(true);

    jest.useRealTimers();
  });
});
