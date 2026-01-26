import { EventEmitter } from 'events';
import { PendingEntry, Snapshot, Target } from '../../bots/collector/config';
import { CollectorControlStack } from '../../bots/collector/control_stack';
import { ReactiveBehaviorRegistry } from '../../bots/collector/reactive_behavior_registry';

export interface PlanningRecord {
  id: string;
  target: Target;
  snapshot: Snapshot;
  entry: PendingEntry;
}

type PlannerHandler = (entry: PendingEntry, ranked: any[], ok: boolean, error?: string) => void;

export class TestWorkerManager {
  private readonly pending = new Map<string, { entry: PendingEntry; handler?: PlannerHandler }>();

  postPlanningRequest(
    id: string,
    target: Target,
    snapshot: Snapshot,
    _inventory: Record<string, number>,
    _version: string,
    _perGenerator: number,
    _pruneWithWorld: boolean,
    _combineSimilarNodes: boolean,
    handlerOrOptions?:
      | PlannerHandler
      | {
          handler?: PlannerHandler;
          frameId?: string;
        }
  ): void {
    let handler: PlannerHandler | undefined;

    if (typeof handlerOrOptions === 'function') {
      handler = handlerOrOptions;
    } else if (handlerOrOptions && typeof handlerOrOptions === 'object') {
      handler = handlerOrOptions.handler;
    }

    const entry: PendingEntry = {
      id,
      target,
      snapshot,
      handler
    };

    this.pending.set(id, { entry, handler });
  }

  resolve(id: string, ranked: any[], ok = true, error?: string): void {
    const record = this.pending.get(id);
    if (!record) {
      throw new Error(`No pending planning request with id ${id}`);
    }
    this.pending.delete(id);

    const { entry, handler } = record;
    if (!handler) {
      throw new Error(`No handler registered for planning request ${id}`);
    }

    handler(entry, ranked, ok, error);
  }

  clearPending(): void {
    this.pending.clear();
  }

  drainPending(): PlanningRecord[] {
    return Array.from(this.pending.entries()).map(([id, { entry }]) => ({
      id,
      target: entry.target,
      snapshot: entry.snapshot,
      entry
    }));
  }

  findByItem(itemName: string): PlanningRecord | null {
    for (const [id, { entry }] of this.pending.entries()) {
      if (entry.target?.item === itemName) {
        return {
          id,
          target: entry.target,
          snapshot: entry.snapshot,
          entry
        };
      }
    }
    return null;
  }
}

export function createMockBot(): any {
  const emitter = new EventEmitter();
  const bot: any = emitter;
  bot.version = '1.20.1';
  bot.inventory = {
    items: jest.fn().mockReturnValue([]),
    slots: new Array(46).fill(null)
  };
  bot.registry = { items: {} };
  bot.clearControlStates = jest.fn();
  bot.removeListener = emitter.removeListener.bind(emitter);
  bot.on = emitter.on.bind(emitter);
  bot.once = emitter.once.bind(emitter);
  bot.emit = emitter.emit.bind(emitter);
  bot.removeAllListeners = emitter.removeAllListeners.bind(emitter);
  bot.chat = jest.fn();
  bot.safeChat = jest.fn();
  bot.blockAt = jest.fn().mockReturnValue(null);
  bot.pathfinder = {
    stop: jest.fn()
  };
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
  return bot;
}

export function createControlHarness(
  bot: any,
  options?: {
    reactiveRegistry?: ReactiveBehaviorRegistry;
    config?: {
      snapshotRadii: number[];
      snapshotYHalf: number | null;
      pruneWithWorld: boolean;
      combineSimilarNodes: boolean;
      perGenerator: number;
      toolDurabilityThreshold: number;
    };
  }
): { controlStack: CollectorControlStack; workerManager: TestWorkerManager; registry: ReactiveBehaviorRegistry } {
  const workerManager = new TestWorkerManager();
  const registry = options?.reactiveRegistry ?? new ReactiveBehaviorRegistry();
  const config = options?.config ?? {
    snapshotRadii: [32],
    snapshotYHalf: null,
    pruneWithWorld: true,
    combineSimilarNodes: false,
    perGenerator: 1,
    toolDurabilityThreshold: 0.3
  };

  const controlStack = new CollectorControlStack(
    bot,
    workerManager as any,
    bot.safeChat ?? (() => {}),
    config,
    registry
  );

  return { controlStack, workerManager, registry };
}
