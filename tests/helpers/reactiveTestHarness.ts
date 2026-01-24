import { EventEmitter } from 'events';
import { BehaviorScheduler, ScheduledBehavior } from '../../bots/collector/behavior_scheduler';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';
import { ReactiveBehaviorExecutorClass } from '../../bots/collector/reactive_behavior_executor';
import { TestWorkerManager } from './schedulerTestUtils';
import { createFakeBot } from '../utils/fakeBot';

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

  bot.attack = jest.fn();
  bot.activateItem = jest.fn();
  bot.deactivateItem = jest.fn();
  bot.consume = jest.fn(async () => {});

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
  readonly scheduler: BehaviorScheduler;
  readonly registry: ReactiveBehaviorRegistry;
  readonly executor: ReactiveBehaviorExecutorClass;
  readonly clock: SimulatedClock;

  constructor(options?: { bot?: any; tickMs?: number; pollIntervalMs?: number }) {
    this.bot = options?.bot ?? createSimulatedBot();
    this.workerManager = new TestWorkerManager();
    this.scheduler = new BehaviorScheduler(this.bot, this.workerManager as any, {
      pollIntervalMs: options?.pollIntervalMs
    });
    this.workerManager.setScheduler(this.scheduler);
    this.registry = new ReactiveBehaviorRegistry();
    this.executor = new ReactiveBehaviorExecutorClass(this.bot, this.registry);
    this.clock = new SimulatedClock(this.bot, options?.tickMs ?? 50, 0);
  }

  enableReactivePolling(): void {
    this.scheduler.setReactivePoller(async () => {
      const behavior = await this.registry.findActiveBehavior(this.bot);
      if (!behavior) return;
      const run = await this.executor.createScheduledRun(behavior);
      if (!run) return;
      try {
        await this.scheduler.pushAndActivate(run, `reactive ${behavior.name || 'unknown'}`);
        await run.waitForCompletion();
      } catch (_) {
      }
    });
  }

  disableReactivePolling(): void {
    this.scheduler.setReactivePoller(null);
  }

  async startBehavior(behavior: ScheduledBehavior): Promise<string> {
    const frameId = this.scheduler.pushBehavior(behavior);
    await this.scheduler.activateTop();
    return frameId;
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
