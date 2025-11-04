import { EventEmitter } from 'events';
import { BehaviorScheduler } from '../../bots/collector/behavior_scheduler';
import { PendingEntry, Snapshot, Target } from '../../bots/collector/config';

export interface PlanningRecord {
  id: string;
  target: Target;
  snapshot: Snapshot;
  entry: PendingEntry;
}

type PlannerHandler = (entry: PendingEntry, ranked: any[], ok: boolean, error?: string) => void;

export class TestWorkerManager {
  private scheduler: BehaviorScheduler | null = null;
  private readonly pending = new Map<string, { entry: PendingEntry; handler?: PlannerHandler }>();

  setScheduler(scheduler: BehaviorScheduler): void {
    this.scheduler = scheduler;
  }

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
    let frameId: string | undefined;

    if (typeof handlerOrOptions === 'function') {
      handler = handlerOrOptions;
    } else if (handlerOrOptions && typeof handlerOrOptions === 'object') {
      handler = handlerOrOptions.handler;
      frameId = handlerOrOptions.frameId;
    }

    const entry: PendingEntry = {
      id,
      target,
      snapshot,
      handler,
      frameId
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
    if (handler) {
      handler(entry, ranked, ok, error);
      return;
    }

    if (!this.scheduler) {
      throw new Error('Scheduler not attached to TestWorkerManager');
    }

    this.scheduler.handlePlannerResult(entry, ranked, ok, error, id);
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
    items: jest.fn().mockReturnValue([])
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
  return bot;
}

export function createSchedulerHarness(bot: any): { scheduler: BehaviorScheduler; workerManager: TestWorkerManager } {
  const workerManager = new TestWorkerManager();
  const scheduler = new BehaviorScheduler(bot, workerManager as any);
  workerManager.setScheduler(scheduler);
  return { scheduler, workerManager };
}

