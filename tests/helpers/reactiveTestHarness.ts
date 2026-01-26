import { EventEmitter } from 'events';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { TestWorkerManager } from './schedulerTestUtils';
import { createFakeBot } from '../utils/fakeBot';
import { getFoodHungerPoints } from '../../utils/foodConfig';
import { CollectorControlStack } from '../../bots/collector/control_stack';
import { ReactiveBehaviorManager } from '../../bots/collector/reactive_behavior_manager';

export interface SimulatedBotOptions {
  position?: { x: number; y: number; z: number };
  worldInit?: Record<string, number>;
  health?: number;
  maxHealth?: number;
  food?: number;
  entities?: Record<string, any>;
  inventory?: {
    slots?: any[];
    items?: any[];
  };
}

export function createSimulatedBot(options: SimulatedBotOptions = {}): any {
  const bot = createFakeBot({
    position: options.position,
    worldInit: options.worldInit
  }) as any;

  const slotCount = 46;
  const slots = options.inventory?.slots ?? new Array(slotCount).fill(null);
  const providedItems = options.inventory?.items ?? null;

  bot.inventory.slots = slots;
  bot.inventory.items = jest.fn().mockImplementation(() => {
    if (providedItems) return providedItems;
    return slots.filter((item: any) => !!item);
  });

  const health = options.health ?? 20;
  const maxHealth = options.maxHealth ?? 20;
  const food = options.food ?? 20;

  bot.health = health;
  bot.maxHealth = maxHealth;
  bot.food = food;

  if (bot.entity) {
    bot.entity.health = health;
    bot.entity.maxHealth = maxHealth;
    if (typeof bot.entity.yaw !== 'number') bot.entity.yaw = 0;
    if (typeof bot.entity.pitch !== 'number') bot.entity.pitch = 0;
    if (typeof bot.entity.height !== 'number') bot.entity.height = 1.8;
  }

  bot.entities = options.entities ?? {};
  bot.registry = bot.registry ?? { items: {} };

  bot.controlStates = {};
  bot.clearControlStates = jest.fn(() => {
    bot.controlStates = {};
  });
  bot.setControlState = jest.fn((state: string, value: boolean) => {
    bot.controlStates[state] = value;
  });
  bot.safeChat = jest.fn();
  bot.chat = jest.fn();
  bot.lookAt = jest.fn();
  bot.look = jest.fn((yaw: number, pitch: number) => {
    if (bot.entity) {
      bot.entity.yaw = yaw;
      bot.entity.pitch = pitch;
    }
  });

  bot.getEquipmentDestSlot = jest.fn((slot: string) => {
    switch (slot) {
      case 'head':
        return 5;
      case 'torso':
        return 6;
      case 'legs':
        return 7;
      case 'feet':
        return 8;
      case 'off-hand':
        return 45;
      default:
        return 36;
    }
  });

  bot.pvp = {
    target: null,
    attack: jest.fn(),
    stop: jest.fn()
  };

  bot.heldItem = null;
  bot.equip = jest.fn(async (item: any, destination: string) => {
    if (destination === 'hand') {
      bot.heldItem = item;
      return;
    }

    if (typeof bot.getEquipmentDestSlot === 'function') {
      const slotIndex = bot.getEquipmentDestSlot(destination);
      if (Number.isInteger(slotIndex)) {
        bot.inventory.slots[slotIndex] = item;
      }
    }
  });

  bot.unequip = jest.fn(async (slot: string) => {
    if (typeof bot.getEquipmentDestSlot !== 'function') return;
    const slotIndex = bot.getEquipmentDestSlot(slot);
    if (!Number.isInteger(slotIndex)) return;
    const removed = bot.inventory.slots[slotIndex] ?? null;
    bot.inventory.slots[slotIndex] = null;
    if (!removed) return;
    const emptyIndex = bot.inventory.slots.findIndex((item: any, index: number) => item == null && index !== slotIndex);
    if (emptyIndex >= 0) {
      bot.inventory.slots[emptyIndex] = removed;
    }
  });

  bot.attack = jest.fn();
  bot.activateItem = jest.fn();
  bot.deactivateItem = jest.fn();
  bot.consume = jest.fn(async () => {
    const held = bot.heldItem;
    if (!held || typeof held.name !== 'string') return;
    const points = getFoodHungerPoints(held.name);
    if (!Number.isFinite(points) || points <= 0) return;
    bot.food = Math.min(20, (bot.food ?? 0) + points);
  });

  if (bot.pathfinder) {
    bot.pathfinder.stop = jest.fn();
  } else {
    bot.pathfinder = {
      stop: jest.fn()
    };
  }

  bot.stopDigging = jest.fn();

  if (!bot.off && typeof bot.removeListener === 'function') {
    bot.off = bot.removeListener.bind(bot);
  }

  return bot;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export class SimulatedClock {
  private nowMs: number;

  constructor(
    private readonly bot: EventEmitter,
    private readonly tickMs: number = 50,
    startMs: number = Date.now()
  ) {
    this.nowMs = startMs;
  }

  async advance(ms: number): Promise<void> {
    const steps = Math.max(1, Math.ceil(ms / this.tickMs));
    for (let i = 0; i < steps; i += 1) {
      jest.advanceTimersByTime(this.tickMs);
      this.nowMs += this.tickMs;
      jest.setSystemTime(this.nowMs);
      await flushMicrotasks();
      this.emitTick();
      await flushMicrotasks();
    }
  }

  async tick(count: number = 1): Promise<void> {
    await this.advance(count * this.tickMs);
  }

  async waitFor(condition: () => boolean, maxMs: number = 2000): Promise<void> {
    const steps = Math.max(1, Math.ceil(maxMs / this.tickMs));
    for (let i = 0; i < steps; i += 1) {
      if (condition()) return;
      // eslint-disable-next-line no-await-in-loop
      await this.tick(1);
    }
    throw new Error('Timed out waiting for condition');
  }

  private emitTick(): void {
    if (typeof (this.bot as any).emit === 'function') {
      (this.bot as any).emit('physicTick');
      (this.bot as any).emit('physicsTick');
    }
  }
}

export class ReactiveTestHarness {
  readonly bot: any;
  readonly workerManager: TestWorkerManager;
  readonly registry: ReactiveBehaviorRegistry;
  readonly controlStack: CollectorControlStack;
  readonly clock: SimulatedClock;

  constructor(options?: { bot?: any; tickMs?: number }) {
    this.bot = options?.bot ?? createSimulatedBot();
    this.workerManager = new TestWorkerManager();
    this.registry = new ReactiveBehaviorRegistry();
    this.controlStack = new CollectorControlStack(
      this.bot,
      this.workerManager as any,
      this.bot.safeChat ?? (() => {}),
      {
        snapshotRadii: [32],
        snapshotYHalf: null,
        pruneWithWorld: true,
        combineSimilarNodes: false,
        perGenerator: 1,
        toolDurabilityThreshold: 0.3
      },
      this.registry
    );
    this.controlStack.start();
    this.controlStack.reactiveLayer.setEnabled(false);
    this.clock = new SimulatedClock(this.bot, options?.tickMs ?? 50, 0);
  }

  get manager(): ReactiveBehaviorManager {
    return this.controlStack.reactiveLayer;
  }

  enableReactivePolling(): void {
    this.controlStack.reactiveLayer.setEnabled(true);
  }

  disableReactivePolling(): void {
    this.controlStack.reactiveLayer.setEnabled(false);
  }

  async tick(count: number = 1): Promise<void> {
    await this.clock.tick(count);
  }

  async advance(ms: number): Promise<void> {
    await this.clock.advance(ms);
  }

  async waitFor(condition: () => boolean, maxMs?: number): Promise<void> {
    await this.clock.waitFor(condition, maxMs);
  }
}
