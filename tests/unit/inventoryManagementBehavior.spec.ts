jest.mock('mineflayer-statemachine', () => {
  class BehaviorIdle {
    active = false;
    onStateEntered(): void {}
    onStateExited(): void {}
    update(): void {}
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

  return { BehaviorIdle, StateTransition, NestedStateMachine };
});

import {
  inventoryManagementBehavior,
  setInventoryManagementConfig,
  resetInventoryManagementCooldown,
  triggerInventoryManagementCooldown,
  calculateItemsToDrop,
  DropCandidate
} from '../../bots/collector/reactive_behaviors/inventory_management_behavior';
import { getEmptySlotCount } from '../../utils/inventory';

jest.useFakeTimers();

// places items into main inventory slots (9-44)
function createBot(mainItems: Array<{ name: string; count: number; type?: number }> = []): any {
  const slots: any[] = new Array(46).fill(null);

  mainItems.forEach((item, i) => {
    if (i + 9 <= 44) {
      slots[i + 9] = { name: item.name, count: item.count, type: item.type ?? 1 };
    }
  });

  return {
    version: '1.20.1',
    entity: { position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 },
    inventory: {
      items: jest.fn(() => slots.filter((s: any) => s != null)),
      slots
    },
    heldItem: null,
    safeChat: jest.fn(),
    chat: jest.fn(),
    look: jest.fn().mockResolvedValue(undefined),
    tossStack: jest.fn().mockResolvedValue(undefined),
    toss: jest.fn().mockResolvedValue(undefined),
    blockAt: jest.fn().mockReturnValue(null)
  };
}

function fillSlots(count: number, item: { name: string; count: number; type?: number } = { name: 'cobblestone', count: 64 }): Array<{ name: string; count: number; type?: number }> {
  return Array.from({ length: count }, () => ({ ...item }));
}

describe('inventoryManagementBehavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.setSystemTime(1000);
    resetInventoryManagementCooldown();
    setInventoryManagementConfig({
      triggerFreeSlots: 2,
      cooldownMs: 60_000,
      getTargets: () => []
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('getEmptySlotCount', () => {
    it('returns 36 for a completely empty inventory', () => {
      const bot = createBot();
      expect(getEmptySlotCount(bot)).toBe(36);
    });

    it('returns correct count with some items', () => {
      const bot = createBot([
        { name: 'cobblestone', count: 64 },
        { name: 'dirt', count: 32 }
      ]);
      expect(getEmptySlotCount(bot)).toBe(34);
    });

    it('returns 0 when inventory is completely full', () => {
      const bot = createBot(fillSlots(36));
      expect(getEmptySlotCount(bot)).toBe(0);
    });

    it('does not count equipment slots', () => {
      const bot = createBot();
      bot.inventory.slots[5] = { name: 'iron_helmet', count: 1, type: 1 };
      bot.inventory.slots[6] = { name: 'iron_chestplate', count: 1, type: 1 };
      expect(getEmptySlotCount(bot)).toBe(36);
    });
  });

  describe('shouldActivate', () => {
    it('returns true when free slots are at the trigger threshold', () => {
      const bot = createBot(fillSlots(34));
      expect(getEmptySlotCount(bot)).toBe(2);
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns true when free slots are below the trigger threshold', () => {
      const bot = createBot(fillSlots(35));
      expect(getEmptySlotCount(bot)).toBe(1);
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(true);
    });

    it('returns false when free slots are above the trigger threshold', () => {
      const bot = createBot(fillSlots(33));
      expect(getEmptySlotCount(bot)).toBe(3);
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(false);
    });

    it('returns false when plenty of space available', () => {
      const bot = createBot(fillSlots(10));
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(false);
    });

    it('returns false when in cooldown', () => {
      const bot = createBot(fillSlots(36));
      triggerInventoryManagementCooldown();
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(false);
    });

    it('returns true after cooldown expires', () => {
      const bot = createBot(fillSlots(36));
      triggerInventoryManagementCooldown();
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(false);

      jest.advanceTimersByTime(60_001);
      jest.setSystemTime(61_001);
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(true);
    });

    it('respects custom trigger threshold', () => {
      setInventoryManagementConfig({ triggerFreeSlots: 5 });

      const bot3free = createBot(fillSlots(33));
      expect(getEmptySlotCount(bot3free)).toBe(3);
      expect(inventoryManagementBehavior.shouldActivate(bot3free)).toBe(true);

      const bot6free = createBot(fillSlots(30));
      expect(getEmptySlotCount(bot6free)).toBe(6);
      expect(inventoryManagementBehavior.shouldActivate(bot6free)).toBe(false);
    });
  });

  describe('calculateItemsToDrop', () => {
    describe('lower-tier tools', () => {
      it('drops the lower-tier tool when two tiers of the same type exist', () => {
        const bot = createBot([
          ...fillSlots(33),
          { name: 'wooden_pickaxe', count: 1 },
          { name: 'iron_pickaxe', count: 1 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        expect(drops.length).toBeGreaterThanOrEqual(1);

        const toolDrop = drops.find((d: DropCandidate) => d.reason === 'lower_tier_tool');
        expect(toolDrop).toBeDefined();
        expect(toolDrop!.item.name).toBe('wooden_pickaxe');
      });

      it('drops stone axe when iron and stone axes exist', () => {
        const bot = createBot([
          ...fillSlots(33),
          { name: 'stone_axe', count: 1 },
          { name: 'iron_axe', count: 1 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const toolDrop = drops.find((d: DropCandidate) => d.reason === 'lower_tier_tool');
        expect(toolDrop).toBeDefined();
        expect(toolDrop!.item.name).toBe('stone_axe');
      });

      it('does not drop tools when only one tier exists', () => {
        const bot = createBot([
          ...fillSlots(34),
          { name: 'iron_pickaxe', count: 1 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const toolDrops = drops.filter((d: DropCandidate) => d.reason === 'lower_tier_tool');
        expect(toolDrops).toHaveLength(0);
      });

      it('drops multiple lower-tier tools across different tool types', () => {
        const bot = createBot([
          ...fillSlots(30),
          { name: 'wooden_pickaxe', count: 1 },
          { name: 'iron_pickaxe', count: 1 },
          { name: 'wooden_axe', count: 1 },
          { name: 'diamond_axe', count: 1 }
        ]);

        const drops = calculateItemsToDrop(bot, 6);
        const toolDrops = drops.filter((d: DropCandidate) => d.reason === 'lower_tier_tool');
        expect(toolDrops).toHaveLength(2);

        const dropNames = toolDrops.map((d: DropCandidate) => d.item.name);
        expect(dropNames).toContain('wooden_pickaxe');
        expect(dropNames).toContain('wooden_axe');
      });
    });

    describe('duplicate stacks', () => {
      it('drops the smaller stack when two stacks of the same item exist', () => {
        const bot = createBot([
          ...fillSlots(33),
          { name: 'oak_log', count: 64 },
          { name: 'oak_log', count: 12 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const dupeDrop = drops.find((d: DropCandidate) => d.reason === 'duplicate_stack');
        expect(dupeDrop).toBeDefined();
        expect(dupeDrop!.item.name).toBe('oak_log');
        expect(dupeDrop!.item.count).toBe(12);
      });

      it('drops smallest stacks first across different items', () => {
        const bot = createBot([
          ...fillSlots(30),
          { name: 'cobblestone', count: 64 },
          { name: 'cobblestone', count: 20 },
          { name: 'dirt', count: 64 },
          { name: 'dirt', count: 5 }
        ]);

        const drops = calculateItemsToDrop(bot, 6);
        const dupeDrops = drops.filter((d: DropCandidate) => d.reason === 'duplicate_stack');
        expect(dupeDrops.length).toBeGreaterThanOrEqual(2);
        expect(dupeDrops[0].item.count).toBeLessThanOrEqual(dupeDrops[1].item.count);
      });

      it('does not flag single stacks as duplicates', () => {
        const uniqueItems = Array.from({ length: 33 }, (_, i) => ({
          name: `filler_item_${i}`, count: 64
        }));
        const bot = createBot([
          ...uniqueItems,
          { name: 'oak_log', count: 32 },
          { name: 'iron_ingot', count: 16 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const dupeDrops = drops.filter((d: DropCandidate) => d.reason === 'duplicate_stack');
        expect(dupeDrops).toHaveLength(0);
      });
    });

    describe('protected items', () => {
      it('does not drop items matching the current target', () => {
        setInventoryManagementConfig({
          getTargets: () => [{ item: 'oak_log', count: 64 }]
        });

        const bot = createBot([
          ...fillSlots(33),
          { name: 'oak_log', count: 64 },
          { name: 'oak_log', count: 10 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const oakDrops = drops.filter((d: DropCandidate) => d.item.name === 'oak_log');
        expect(oakDrops).toHaveLength(0);
      });

      it('does not drop food items', () => {
        const bot = createBot([
          ...fillSlots(33),
          { name: 'cooked_beef', count: 32 },
          { name: 'cooked_beef', count: 8 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const foodDrops = drops.filter((d: DropCandidate) => d.item.name === 'cooked_beef');
        expect(foodDrops).toHaveLength(0);
      });

      it('does not drop workstation items', () => {
        const bot = createBot([
          ...fillSlots(33),
          { name: 'crafting_table', count: 1 },
          { name: 'crafting_table', count: 1 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const wsDrops = drops.filter((d: DropCandidate) => d.item.name === 'crafting_table');
        expect(wsDrops).toHaveLength(0);
      });

      it('does not drop lower-tier tool if it matches the current target', () => {
        setInventoryManagementConfig({
          getTargets: () => [{ item: 'wooden_pickaxe', count: 1 }]
        });

        const bot = createBot([
          ...fillSlots(33),
          { name: 'wooden_pickaxe', count: 1 },
          { name: 'iron_pickaxe', count: 1 }
        ]);

        const drops = calculateItemsToDrop(bot, 4);
        const pickaxeDrops = drops.filter((d: DropCandidate) => d.item.name === 'wooden_pickaxe');
        expect(pickaxeDrops).toHaveLength(0);
      });
    });

    describe('edge cases', () => {
      it('returns empty when all items are protected', () => {
        setInventoryManagementConfig({
          getTargets: () => [{ item: 'cobblestone', count: 64 }]
        });

        const items = fillSlots(36, { name: 'cobblestone', count: 64 });
        const bot = createBot(items);

        const drops = calculateItemsToDrop(bot, 4);
        expect(drops).toHaveLength(0);
      });

      it('returns empty when inventory has enough free slots', () => {
        const bot = createBot(fillSlots(20));
        const drops = calculateItemsToDrop(bot, 4);
        expect(drops).toHaveLength(0);
      });

      it('limits drops to the number of slots needed', () => {
        const bot = createBot([
          ...fillSlots(30),
          { name: 'oak_log', count: 64 },
          { name: 'oak_log', count: 10 },
          { name: 'dirt', count: 64 },
          { name: 'dirt', count: 5 },
          { name: 'gravel', count: 64 },
          { name: 'gravel', count: 3 }
        ]);

        // 36 - 36 = 0 free, need 2 to reach target of 2
        const drops = calculateItemsToDrop(bot, 2);
        expect(drops.length).toBeLessThanOrEqual(2);
      });

      it('prioritises lower-tier tools over duplicate stacks', () => {
        const bot = createBot([
          ...fillSlots(31),
          { name: 'wooden_pickaxe', count: 1 },
          { name: 'iron_pickaxe', count: 1 },
          { name: 'oak_log', count: 64 },
          { name: 'oak_log', count: 10 }
        ]);

        const drops = calculateItemsToDrop(bot, 2);
        expect(drops.length).toBeGreaterThanOrEqual(1);
        expect(drops[0].reason).toBe('lower_tier_tool');
      });
    });
  });

  describe('createState', () => {
    it('returns null and starts cooldown when nothing can be dropped', async () => {
      setInventoryManagementConfig({
        getTargets: () => [{ item: 'cobblestone', count: 64 }]
      });

      const items = fillSlots(36, { name: 'cobblestone', count: 64 });
      const bot = createBot(items);

      const state = await inventoryManagementBehavior.createState(bot);
      expect(state).toBeNull();

      // cooldown should now be active
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(false);
    });

    it('returns null when in cooldown', async () => {
      triggerInventoryManagementCooldown();

      const bot = createBot(fillSlots(36));
      const state = await inventoryManagementBehavior.createState(bot);
      expect(state).toBeNull();
    });

    it('returns a state with stateMachine when items can be dropped', async () => {
      const bot = createBot([
        ...fillSlots(33),
        { name: 'wooden_pickaxe', count: 1 },
        { name: 'iron_pickaxe', count: 1 }
      ]);

      const state = await inventoryManagementBehavior.createState(bot);
      expect(state).not.toBeNull();
      expect(state!.stateMachine).toBeDefined();
      expect(typeof state!.isFinished).toBe('function');
      expect(typeof state!.wasSuccessful).toBe('function');
      expect(typeof state!.onStop).toBe('function');
    });

    it('sets cooldown on completed stop', async () => {
      const bot = createBot([
        ...fillSlots(33),
        { name: 'wooden_pickaxe', count: 1 },
        { name: 'iron_pickaxe', count: 1 }
      ]);

      const state = await inventoryManagementBehavior.createState(bot);
      expect(state).not.toBeNull();

      state!.onStop!('completed');

      // cooldown should be active
      const fullBot = createBot(fillSlots(36));
      expect(inventoryManagementBehavior.shouldActivate(fullBot)).toBe(false);
    });

    it('does not set cooldown on preemption', async () => {
      const bot = createBot([
        ...fillSlots(33),
        { name: 'wooden_pickaxe', count: 1 },
        { name: 'iron_pickaxe', count: 1 }
      ]);

      const state = await inventoryManagementBehavior.createState(bot);
      expect(state).not.toBeNull();

      state!.onStop!('preempted');

      // should still be able to activate (no cooldown set)
      const fullBot = createBot(fillSlots(36));
      expect(inventoryManagementBehavior.shouldActivate(fullBot)).toBe(true);
    });

    it('sends chat message when starting', async () => {
      const bot = createBot([
        ...fillSlots(33),
        { name: 'wooden_pickaxe', count: 1 },
        { name: 'iron_pickaxe', count: 1 }
      ]);

      await inventoryManagementBehavior.createState(bot);
      expect(bot.safeChat).toHaveBeenCalledWith(
        expect.stringContaining('inventory nearly full')
      );
    });
  });

  describe('behavior metadata', () => {
    it('has the correct priority', () => {
      expect(inventoryManagementBehavior.priority).toBe(30);
    });

    it('has the correct name', () => {
      expect(inventoryManagementBehavior.name).toBe('inventory_management');
    });
  });
});
