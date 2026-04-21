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

// Mock composed sub-behaviors so the test can step through transitions
// without needing a real pathfinder / world.
jest.mock('../../behaviors/behaviorCaptureOrigin', () => {
  class BehaviorCaptureOrigin {
    stateName = 'CaptureOrigin';
    active = false;
    private finished = false;
    constructor(public bot: any, public targets: any) {}
    onStateEntered() {
      this.active = true;
      const pos = this.bot?.entity?.position;
      if (pos) this.targets.originPosition = { x: pos.x, y: pos.y, z: pos.z };
      this.finished = true;
    }
    onStateExited() { this.active = false; }
    isFinished() { return this.finished; }
  }
  return { BehaviorCaptureOrigin, default: BehaviorCaptureOrigin };
});

jest.mock('../../behaviors/behaviorTossCandidates', () => {
  class BehaviorTossCandidates {
    stateName = 'TossCandidates';
    active = false;
    private finished = false;
    private dropped = 0;
    constructor(public bot: any, public targets: any) {}
    onStateEntered() {
      this.active = true;
      this.finished = false;
      this.dropped = 0;
      for (const c of this.targets?.dropCandidates || []) {
        try {
          this.bot.tossStack?.(c.item);
          this.dropped++;
        } catch (_) { /* ignore */ }
      }
      this.finished = true;
    }
    onStateExited() { this.active = false; }
    isFinished() { return this.finished; }
    droppedCount() { return this.dropped; }
    wasSuccessful() { return this.dropped > 0; }
  }
  return { BehaviorTossCandidates, default: BehaviorTossCandidates };
});

jest.mock('../../behaviors/behaviorWander', () => {
  class BehaviorWander {
    stateName = 'wander';
    active = false;
    isFinished: any = false;
    constructor(public bot: any, public distance: number, public _c?: any, public targets?: any) {}
    onStateEntered() {
      this.active = true;
      if (this.targets) this.targets.wanderYaw = Math.PI; // 180° → due south in MC
      this.isFinished = true;
    }
    onStateExited() { this.active = false; }
    update() {}
  }
  return { BehaviorWander, default: BehaviorWander };
});

jest.mock('../../behaviors/behaviorSmartMoveTo', () => {
  class BehaviorSmartMoveTo {
    stateName = 'smartMoveTo';
    active = false;
    private finished = false;
    constructor(public bot: any, public targets: any) {}
    onStateEntered() {
      this.active = true;
      this.finished = true;
    }
    onStateExited() { this.active = false; }
    isFinished() { return this.finished; }
  }
  return { BehaviorSmartMoveTo, default: BehaviorSmartMoveTo };
});

jest.mock('../../behaviors/behaviorLookAt', () => {
  // Factory returning an object with state-machine surface.
  function createLookAtState(_bot: any, _targets: any) {
    const machine: any = {
      stateName: 'LookAt',
      _entered: false,
      _finished: false,
      onStateEntered() { this._entered = true; this._finished = true; },
      onStateExited() { this._entered = false; },
      isFinished() { return this._finished; }
    };
    return machine;
  }
  return { __esModule: true, default: createLookAtState };
});

jest.mock('../../behaviors/behaviorClearArea', () => {
  function createClearAreaState(_bot: any, _targets: any) {
    const machine: any = {
      stateName: 'ClearArea',
      _entered: false,
      _finished: false,
      onStateEntered() { this._entered = true; this._finished = true; },
      onStateExited() { this._entered = false; },
      isFinished() { return this._finished; }
    };
    return machine;
  }
  return { __esModule: true, default: createClearAreaState };
});

import {
  createInventoryManagementBehavior,
  calculateItemsToDrop as calculateItemsToDropRaw,
  DropCandidate,
  InventoryManagementConfig,
  InventoryManagementHandle
} from '../../bots/collector/reactive_behaviors/inventory_management_behavior';
import { getEmptySlotCount } from '../../utils/inventory';

jest.useFakeTimers();

// Per-test factory instance (rebuilt in beforeEach so each test gets its own
// cooldown/config state — no module singletons). The shim variables below
// delegate to the current handle so the pre-existing call sites keep working.
let _handle: InventoryManagementHandle;

// Track the getTargets supplied via setInventoryManagementConfig so
// calculateItemsToDrop (which used to read module state) uses the same
// accessor in tests.
let _currentGetTargets: () => Array<{ item: string; count: number }> = () => [];

const inventoryManagementBehavior = new Proxy({} as any, {
  get(_target, prop: string) {
    return (_handle as any).behavior[prop];
  }
});

function setInventoryManagementConfig(partial: Partial<InventoryManagementConfig>): void {
  _handle.setConfig(partial);
  if (typeof partial.getTargets === 'function') {
    _currentGetTargets = partial.getTargets;
  }
}

function getInventoryManagementConfig(): InventoryManagementConfig {
  return _handle.getConfig();
}

function resetInventoryManagementCooldown(): void {
  _handle.resetCooldown();
}

function triggerInventoryManagementCooldown(): void {
  _handle.triggerCooldown();
}

// calculateItemsToDrop is a pure function on the module, but it used to
// read module-level `config.getTargets`. Now it takes getTargets as a
// parameter. Tests that called `calculateItemsToDrop(bot, n)` continue
// to work via this shim, which threads through the currently-set
// getTargets accessor.
function calculateItemsToDrop(bot: any, targetFreeSlots: number): DropCandidate[] {
  return calculateItemsToDropRaw(bot, targetFreeSlots, _currentGetTargets);
}

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
    _handle = createInventoryManagementBehavior();
    _currentGetTargets = () => [];
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
      it('protects the target stack but drops excess target items', () => {
        // Under Phase 0, target items are protected only up to the target quantity.
        // target=64 oak_log, held=74 (64 + 10) → excess=10, 10-stack dropped,
        // 64-stack preserved.
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
        expect(oakDrops).toHaveLength(1);
        expect(oakDrops[0].reason).toBe('excess_over_target');
        expect(oakDrops[0].item.count).toBe(10);
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
        // Food is fully protected regardless of targets, so a pure-food
        // inventory yields no drop candidates.
        const items = fillSlots(36, { name: 'cooked_beef', count: 32 });
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

    describe('Phase 0: excess over target', () => {
      it('drops excess stacks when held > target', () => {
        // target=64 cobble, held = two stacks of 64 = 128, excess = 64
        setInventoryManagementConfig({
          getTargets: () => [{ item: 'cobblestone', count: 64 }]
        });
        const bot = createBot([
          { name: 'cobblestone', count: 64 },
          { name: 'cobblestone', count: 64 },
          ...fillSlots(34, { name: 'dirt', count: 64 })
        ]);
        const candidates = calculateItemsToDrop(bot, 2);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].reason).toBe('excess_over_target');
        expect(candidates[0].item.name).toBe('cobblestone');
      });

      it('skips a stack when dropping it would exceed excess', () => {
        // target=64, held=70 (64 + 6), excess=6, drop only the 6-stack
        setInventoryManagementConfig({
          getTargets: () => [{ item: 'cobblestone', count: 64 }]
        });
        const bot = createBot([
          { name: 'cobblestone', count: 64 },
          { name: 'cobblestone', count: 6 },
          ...fillSlots(34, { name: 'dirt', count: 64 })
        ]);
        const candidates = calculateItemsToDrop(bot, 2);
        const phase0 = candidates.filter(c => c.reason === 'excess_over_target');
        expect(phase0).toHaveLength(1);
        expect(phase0[0].item.count).toBe(6);
      });

      it('sums multiple targets for same item', () => {
        setInventoryManagementConfig({
          getTargets: () => [
            { item: 'cobblestone', count: 64 },
            { item: 'cobblestone', count: 32 }
          ]
        });
        const bot = createBot([
          { name: 'cobblestone', count: 64 }, // held=64, protected=96, excess<=0
          ...fillSlots(34, { name: 'dirt', count: 64 })
        ]);
        const candidates = calculateItemsToDrop(bot, 2);
        expect(candidates.filter(c => c.reason === 'excess_over_target')).toHaveLength(0);
      });

      it('does not run Phase 0 when no targets configured', () => {
        setInventoryManagementConfig({ getTargets: () => [] });
        const bot = createBot(fillSlots(35, { name: 'cobblestone', count: 64 }));
        const candidates = calculateItemsToDrop(bot, 2);
        expect(candidates.every(c => c.reason !== 'excess_over_target')).toBe(true);
      });

      it('still protects food and workstations from Phase 0', () => {
        setInventoryManagementConfig({
          getTargets: () => [{ item: 'cooked_beef', count: 1 }]
        });
        const bot = createBot([
          { name: 'cooked_beef', count: 64 }, // held=64, target=1, would be excess 63
          ...fillSlots(34, { name: 'dirt', count: 64 })
        ]);
        const candidates = calculateItemsToDrop(bot, 2);
        expect(candidates.every(c => c.item.name !== 'cooked_beef')).toBe(true);
      });

      it('does not double-pick a stack already chosen by Phase 0 in Phase 2', () => {
        // target=64, held=96 (64 + 32), excess=32. Phase 0 picks the 32-stack.
        // Phase 2's duplicate-stack logic must not also pick it (would double-drop).
        setInventoryManagementConfig({
          getTargets: () => [{ item: 'cobblestone', count: 64 }]
        });
        const bot = createBot([
          { name: 'cobblestone', count: 64 },
          { name: 'cobblestone', count: 32 },
          ...fillSlots(34, { name: 'dirt', count: 64 })
        ]);
        const candidates = calculateItemsToDrop(bot, 2);
        const cobbleDrops = candidates.filter(c => c.item.name === 'cobblestone');
        expect(cobbleDrops).toHaveLength(1);
        expect(cobbleDrops[0].reason).toBe('excess_over_target');
        expect(cobbleDrops[0].item.count).toBe(32);
      });
    });
  });

  describe('createState (composed)', () => {
    it('returns null and starts cooldown when nothing can be dropped', async () => {
      // An inventory of pure food (fully protected) yields no drop candidates,
      // so createState returns null and starts the cooldown.
      const items = fillSlots(36, { name: 'cooked_beef', count: 32 });
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

    it('walks the composed machine to completion and tosses candidates', async () => {
      setInventoryManagementConfig({
        reactiveThreshold: 3,
        preGateThreshold: 2,
        cooldownMs: 30_000,
        getTargets: () => [{ item: 'cobblestone', count: 64 }]
      });
      const bot = createBot([
        { name: 'cobblestone', count: 64 },
        { name: 'cobblestone', count: 64 },
        ...fillSlots(34, { name: 'dirt', count: 64 })
      ]);

      const state = await inventoryManagementBehavior.createState(bot);
      expect(state).not.toBeNull();

      // Step the machine through all states. Our mocked NestedStateMachine
      // advances synchronously as long as each sub-state's isFinished() is
      // true after onStateEntered, which our sub-state mocks guarantee.
      state!.stateMachine.onStateEntered();

      expect(bot.tossStack).toHaveBeenCalled();
      expect(state!.wasSuccessful!()).toBe(true);
      expect(state!.isFinished!()).toBe(true);
    });

    it('falls back to bot.entity.yaw when Wander did not publish wanderYaw', async () => {
      // Override the BehaviorWander mock just for this test so it does NOT
      // write targets.wanderYaw. The wander→lookAt transition should then
      // fall back to bot.entity.yaw via `?? bot.entity.yaw ?? 0`.
      const BehaviorWanderMod = require('../../behaviors/behaviorWander');
      const orig = BehaviorWanderMod.BehaviorWander;
      class BehaviorWanderNoYaw {
        stateName = 'wander';
        active = false;
        isFinished: any = false;
        bot: any;
        distance: number;
        _c: any;
        targets: any;
        constructor(bot: any, distance: number, _c?: any, targets?: any) {
          this.bot = bot;
          this.distance = distance;
          this._c = _c;
          this.targets = targets;
        }
        onStateEntered() {
          this.active = true;
          // intentionally DOES NOT write targets.wanderYaw
          this.isFinished = true;
        }
        onStateExited() { this.active = false; }
        update() {}
      }
      BehaviorWanderMod.BehaviorWander = BehaviorWanderNoYaw;
      BehaviorWanderMod.default = BehaviorWanderNoYaw;

      try {
        setInventoryManagementConfig({
          reactiveThreshold: 3,
          getTargets: () => [{ item: 'cobblestone', count: 64 }]
        });
        const bot = createBot([
          { name: 'cobblestone', count: 64 },
          { name: 'cobblestone', count: 64 },
          ...fillSlots(34, { name: 'dirt', count: 64 })
        ]);
        bot.entity.yaw = 1.5; // sanity: bot has a yaw to fall back to

        const state = await inventoryManagementBehavior.createState!(bot);
        expect(state).not.toBeNull();
        state!.stateMachine.onStateEntered();
        // If the fallback worked we reached the end of the machine without crashing.
        expect(state!.isFinished!()).toBe(true);
      } finally {
        BehaviorWanderMod.BehaviorWander = orig;
        BehaviorWanderMod.default = orig;
      }
    });

    it('finishes machine even when originPosition was never captured', async () => {
      // Override BehaviorCaptureOrigin so it does not write targets.originPosition.
      // The toss→moveBack transition should skip the position write but the
      // machine should still complete cleanly.
      const BehaviorCaptureOriginMod = require('../../behaviors/behaviorCaptureOrigin');
      const orig = BehaviorCaptureOriginMod.BehaviorCaptureOrigin;
      class BehaviorCaptureOriginNoWrite {
        stateName = 'CaptureOrigin';
        active = false;
        private finished = false;
        bot: any;
        targets: any;
        constructor(bot: any, targets: any) {
          this.bot = bot;
          this.targets = targets;
        }
        onStateEntered() {
          this.active = true;
          // intentionally does NOT write targets.originPosition
          this.finished = true;
        }
        onStateExited() { this.active = false; }
        isFinished() { return this.finished; }
      }
      BehaviorCaptureOriginMod.BehaviorCaptureOrigin = BehaviorCaptureOriginNoWrite;
      BehaviorCaptureOriginMod.default = BehaviorCaptureOriginNoWrite;

      try {
        setInventoryManagementConfig({
          reactiveThreshold: 3,
          getTargets: () => [{ item: 'cobblestone', count: 64 }]
        });
        const bot = createBot([
          { name: 'cobblestone', count: 64 },
          { name: 'cobblestone', count: 64 },
          ...fillSlots(34, { name: 'dirt', count: 64 })
        ]);
        const state = await inventoryManagementBehavior.createState!(bot);
        expect(state).not.toBeNull();
        state!.stateMachine.onStateEntered();
        expect(state!.isFinished!()).toBe(true); // machine completes regardless
      } finally {
        BehaviorCaptureOriginMod.BehaviorCaptureOrigin = orig;
        BehaviorCaptureOriginMod.default = orig;
      }
    });

    it('captures origin position on entry and routes it to SmartMoveTo back', async () => {
      setInventoryManagementConfig({
        reactiveThreshold: 3,
        preGateThreshold: 2,
        cooldownMs: 30_000,
        getTargets: () => [{ item: 'cobblestone', count: 64 }]
      });
      const bot = createBot([
        { name: 'cobblestone', count: 64 },
        { name: 'cobblestone', count: 64 },
        ...fillSlots(34, { name: 'dirt', count: 64 })
      ]);
      bot.entity.position = { x: 42, y: 70, z: -17 };

      const state = await inventoryManagementBehavior.createState(bot);
      expect(state).not.toBeNull();
      state!.stateMachine.onStateEntered();

      // The mocked state machine will have executed every transition. After
      // toss → moveBack, targets.position should be a Vec3 built from the
      // captured origin position.
      const sm: any = state!.stateMachine;
      // Reach inside the NestedStateMachine and find the Wander→LookAt
      // transition's shared targets (all share the same instance).
      const sharedTargets = sm.transitions[0].parent.targets;
      expect(sharedTargets.originPosition).toEqual({ x: 42, y: 70, z: -17 });
      // After the toss→moveBack transition, targets.position is set.
      expect(sharedTargets.position).toBeDefined();
      expect(sharedTargets.position.x).toBe(42);
      expect(sharedTargets.position.y).toBe(70);
      expect(sharedTargets.position.z).toBe(-17);
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

  describe('config extensions', () => {
    it('accepts reactiveThreshold and uses it for shouldActivate', () => {
      setInventoryManagementConfig({ reactiveThreshold: 5 });
      const bot = createBot(fillSlots(32)); // 4 free slots
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(true);
      setInventoryManagementConfig({ reactiveThreshold: 3 });
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(false);
    });

    it('keeps triggerFreeSlots as a back-compat alias for reactiveThreshold', () => {
      setInventoryManagementConfig({ triggerFreeSlots: 5 });
      const bot = createBot(fillSlots(32));
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(true);
    });

    it('prefers explicit reactiveThreshold over triggerFreeSlots alias when both supplied', () => {
      setInventoryManagementConfig({ triggerFreeSlots: 5, reactiveThreshold: 3 });
      const bot = createBot(fillSlots(32)); // 4 free slots
      // reactiveThreshold=3 wins → 4 > 3 → no activation
      expect(inventoryManagementBehavior.shouldActivate(bot)).toBe(false);
    });

    it('exposes preGateThreshold default via getInventoryManagementConfig', () => {
      // reset to defaults
      setInventoryManagementConfig({
        reactiveThreshold: 3,
        preGateThreshold: 2,
        cooldownMs: 60_000
      });
      const cfg = getInventoryManagementConfig();
      expect(cfg.preGateThreshold).toBe(2);
    });
  });
});
