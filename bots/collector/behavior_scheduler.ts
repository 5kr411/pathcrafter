import logger from '../../utils/logger';
import { Bot, PendingEntry } from './config';
import { WorkerManager } from './worker_manager';

export type BehaviorStatus = 'pending' | 'active' | 'suspended' | 'completed' | 'aborted';

export interface ScheduledBehavior {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly type: string;
  activate(context: BehaviorFrameContext): Promise<void>;
  onSuspend(context: BehaviorFrameContext): Promise<void>;
  onResume(context: BehaviorFrameContext): Promise<void>;
  onAbort(context: BehaviorFrameContext): Promise<void>;
  onComplete?(context: BehaviorFrameContext, success: boolean): Promise<void> | void;
}

export interface BehaviorFrameContext {
  readonly bot: Bot;
  readonly scheduler: BehaviorScheduler;
  readonly workerManager: WorkerManager;
  readonly frameId: string;
  readonly type: string;
  readonly name: string;
  attachStateMachine(stateMachine: any, listener: (this: Bot) => void): void;
  detachStateMachine(): void;
  attachCleanup(cleanup: () => void): void;
  attachPlannerHandler(
    plannerId: string,
    handler: (entry: PendingEntry, ranked: any[], ok: boolean, error?: string) => void
  ): void;
  detachPlannerHandler(plannerId: string): void;
}

interface PlannerHandlerEntry {
  plannerId: string;
  handler: (entry: PendingEntry, ranked: any[], ok: boolean, error?: string) => void;
}

interface BehaviorFrame {
  frameId: string;
  behavior: ScheduledBehavior;
  status: BehaviorStatus;
  plannerHandlers: Map<string, PlannerHandlerEntry>;
  cleanupListeners: Array<() => void>;
  suspendDepth: number;
  stateMachine: any;
  stateMachineListener: ((this: Bot) => void) | null;
  rootStateMachine: any;
  hasStarted: boolean;
}

function logDebug(msg: string, ...args: any[]): void {
  logger.debug(msg, ...args);
}

function logInfo(msg: string, ...args: any[]): void {
  logger.info(msg, ...args);
}

export interface BehaviorSchedulerOptions {
  readonly pollIntervalMs?: number;
}

let frameCounter = 0;

export class BehaviorScheduler {
  private readonly stack: BehaviorFrame[] = [];
  private readonly plannerIndex = new Map<string, string>();
  private reactivePollInterval: NodeJS.Timeout | null = null;
  private reactivePollCallback: (() => Promise<void> | void) | null = null;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly bot: Bot,
    private readonly workerManager: WorkerManager,
    options?: BehaviorSchedulerOptions
  ) {
    this.pollIntervalMs = Math.max(50, options?.pollIntervalMs ?? 250);
  }

  setReactivePoller(callback: (() => Promise<void> | void) | null): void {
    this.reactivePollCallback = callback;
    if (!callback) {
      this.stopReactivePolling();
      return;
    }
    this.startReactivePolling();
  }

  startReactivePolling(): void {
    if (!this.reactivePollCallback) {
      return;
    }
    this.stopReactivePolling();
    this.reactivePollInterval = setInterval(async () => {
      if (!this.reactivePollCallback) {
        return;
      }
      const active = this.getActiveFrameId();
      if (!active) {
        return;
      }
      try {
        await this.reactivePollCallback();
      } catch (err: any) {
        logDebug(`BehaviorScheduler: reactive poll error: ${err?.message || err}`);
      }
    }, this.pollIntervalMs);
  }

  stopReactivePolling(): void {
    if (this.reactivePollInterval) {
      clearInterval(this.reactivePollInterval);
      this.reactivePollInterval = null;
    }
  }

  registerPlannerHandler(
    frameId: string,
    plannerId: string,
    handler: (entry: PendingEntry, ranked: any[], ok: boolean, error?: string) => void
  ): void {
    const frame = this.stack.find((f) => f.frameId === frameId);
    if (!frame) {
      logDebug(`BehaviorScheduler: attempted to register planner handler for missing frame ${frameId}`);
      return;
    }
    frame.plannerHandlers.set(plannerId, { plannerId, handler });
    this.plannerIndex.set(plannerId, frameId);
  }

  unregisterPlannerHandler(frameId: string, plannerId: string): void {
    const frame = this.stack.find((f) => f.frameId === frameId);
    if (!frame) return;
    frame.plannerHandlers.delete(plannerId);
    this.plannerIndex.delete(plannerId);
  }

  handlePlannerResult(entry: PendingEntry, ranked: any[], ok: boolean, error?: string, plannerId?: string): void {
    if (!plannerId) {
      logDebug('BehaviorScheduler: planner result missing id, delivering to top frame if any');
      const active = this.stack[this.stack.length - 1];
      if (active) {
        this.deliverPlannerResult(active, entry, ranked, ok, error, undefined);
      }
      return;
    }

    const frameId = this.plannerIndex.get(plannerId);
    if (!frameId) {
      logDebug(`BehaviorScheduler: no frame registered for planner id ${plannerId}`);
      return;
    }

    const frame = this.stack.find((f) => f.frameId === frameId);
    if (!frame) {
      logDebug(`BehaviorScheduler: frame ${frameId} missing for planner id ${plannerId}`);
      this.plannerIndex.delete(plannerId);
      return;
    }

    this.deliverPlannerResult(frame, entry, ranked, ok, error, plannerId);
  }

  private deliverPlannerResult(
    frame: BehaviorFrame,
    entry: PendingEntry,
    ranked: any[],
    ok: boolean,
    error?: string,
    plannerId?: string
  ): void {
    if (plannerId) {
      this.plannerIndex.delete(plannerId);
    }
    const handlerKey = plannerId ?? '__default__';
    const handlerEntry = plannerId
      ? frame.plannerHandlers.get(plannerId)
      : frame.plannerHandlers.get(handlerKey);
    if (!handlerEntry) {
      logDebug(
        `BehaviorScheduler: no handler registered on frame ${frame.frameId} for planner id ${plannerId ?? 'default'}`
      );
      return;
    }
    try {
      handlerEntry.handler(entry, ranked, ok, error);
    } catch (err: any) {
      logInfo(
        `BehaviorScheduler: error delivering planner result to frame ${frame.frameId} (${frame.behavior.name}): ${
          err?.message || err
        }`
      );
    }
  }

  pushBehavior(behavior: ScheduledBehavior): string {
    const frameId = this.nextFrameId();
    const frame: BehaviorFrame = {
      frameId,
      behavior,
      status: 'pending',
      plannerHandlers: new Map(),
      cleanupListeners: [],
      suspendDepth: 0,
      stateMachine: null,
      stateMachineListener: null,
      rootStateMachine: null,
      hasStarted: false
    };
    this.stack.push(frame);
    logDebug(`BehaviorScheduler: pushed behavior ${behavior.name} (${frameId}) priority=${behavior.priority}`);
    return frameId;
  }

  async activateTop(): Promise<void> {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) {
      logDebug('BehaviorScheduler: activateTop called with empty stack');
      return;
    }

    const context = this.createContext(frame);

    if (frame.status === 'active') {
      logDebug(`BehaviorScheduler: frame ${frame.frameId} already active`);
      return;
    }

    if (frame.status === 'suspended') {
      frame.status = 'active';
      try {
        await frame.behavior.onResume(context);
        logDebug(`BehaviorScheduler: resumed behavior ${frame.behavior.name} (${frame.frameId})`);
      } catch (err: any) {
        logInfo(
          `BehaviorScheduler: error resuming behavior ${frame.behavior.name} (${frame.frameId}): ${err?.message || err}`
        );
      }
      return;
    }

    try {
      frame.status = 'active';
      await frame.behavior.activate(context);
      logDebug(`BehaviorScheduler: activated behavior ${frame.behavior.name} (${frame.frameId})`);
    } catch (err: any) {
      frame.status = 'aborted';
      logInfo(
        `BehaviorScheduler: behavior ${frame.behavior.name} (${frame.frameId}) activation failed: ${
          err?.message || err
        }`
      );
      await this.abortFrame(frame.frameId);
    }
  }

  async suspendActive(reason: string): Promise<void> {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) {
      logDebug('BehaviorScheduler: suspendActive with empty stack');
      return;
    }
    if (frame.status !== 'active') {
      logDebug(`BehaviorScheduler: top frame ${frame.frameId} not active (status=${frame.status})`);
      return;
    }

    frame.suspendDepth += 1;
    frame.status = 'suspended';
    logDebug(`BehaviorScheduler: suspending ${frame.behavior.name} (${frame.frameId}) reason=${reason}`);
    await frame.behavior.onSuspend(this.createContext(frame));
  }

  async pushAndActivate(behavior: ScheduledBehavior, reason: string): Promise<string> {
    const currentId = this.getActiveFrameId();
    if (currentId) {
      await this.suspendActive(reason);
    }
    const frameId = this.pushBehavior(behavior);
    await this.activateTop();
    return frameId;
  }

  async resume(frameId: string): Promise<void> {
    const frame = this.stack.find((f) => f.frameId === frameId);
    if (!frame) {
      logDebug(`BehaviorScheduler: resume requested for missing frame ${frameId}`);
      return;
    }
    if (frame.status !== 'suspended') {
      logDebug(`BehaviorScheduler: resume skipped for frame ${frameId} status=${frame.status}`);
      return;
    }
    frame.status = 'active';
    if (frame.suspendDepth > 0) {
      frame.suspendDepth -= 1;
    }
    await frame.behavior.onResume(this.createContext(frame));
    logDebug(`BehaviorScheduler: resumed behavior ${frame.behavior.name} (${frame.frameId})`);
  }

  async abortFrame(frameId: string): Promise<void> {
    const index = this.stack.findIndex((f) => f.frameId === frameId);
    if (index === -1) {
      logDebug(`BehaviorScheduler: abort requested for missing frame ${frameId}`);
      return;
    }
    const [frame] = this.stack.splice(index, 1);
    this.releaseFrame(frame);
    try {
      await frame.behavior.onAbort(this.createContext(frame));
    } catch (err: any) {
      logInfo(
        `BehaviorScheduler: error during abort of ${frame.behavior.name} (${frame.frameId}): ${err?.message || err}`
      );
    }
    if (index === this.stack.length) {
      await this.activateTop();
    }
  }

  getActiveFrameId(): string | null {
    const frame = this.stack[this.stack.length - 1];
    return frame && frame.status === 'active' ? frame.frameId : null;
  }

  attachCleanup(frameId: string, cleanup: () => void): void {
    const frame = this.stack.find((f) => f.frameId === frameId);
    if (!frame) return;
    frame.cleanupListeners.push(cleanup);
  }

  async completeFrame(frameId: string, success: boolean): Promise<void> {
    const index = this.stack.findIndex((f) => f.frameId === frameId);
    if (index === -1) {
      logDebug(`BehaviorScheduler: completeFrame called for missing frame ${frameId}`);
      return;
    }
    const [frame] = this.stack.splice(index, 1);
    frame.status = success ? 'completed' : 'aborted';
    await this.invokeCompletionHook(frame, success);
    this.releaseFrame(frame);
    if (index === this.stack.length) {
      await this.activateTop();
    }
  }

  private async invokeCompletionHook(frame: BehaviorFrame, success: boolean): Promise<void> {
    if (!frame.behavior.onComplete) {
      return;
    }
    try {
      await frame.behavior.onComplete(this.createContext(frame), success);
    } catch (err: any) {
      logInfo(
        `BehaviorScheduler: error during completion hook for ${frame.behavior.name} (${frame.frameId}): ${
          err?.message || err
        }`
      );
    }
  }

  attachStateMachine(frameId: string, stateMachine: any, listener: (this: Bot) => void): void {
    const frame = this.stack.find((f) => f.frameId === frameId);
    if (!frame) return;
    const previousRoot = frame.rootStateMachine;
    if (frame.stateMachineListener) {
      try {
        this.bot.removeListener('physicTick', frame.stateMachineListener);
        this.bot.removeListener('physicsTick', frame.stateMachineListener);
      } catch (_) {}
    }
    frame.stateMachine = stateMachine;
    frame.stateMachineListener = listener;
    try {
      this.bot.on('physicTick', listener);
      this.bot.on('physicsTick', listener);
    } catch (_) {}
    if (stateMachine && stateMachine.rootStateMachine) {
      const root = stateMachine.rootStateMachine;
      frame.rootStateMachine = root;
      const isNewRoot = root !== previousRoot;
      if (isNewRoot) {
        frame.hasStarted = false;
      }
      root.active = true;
      if (!frame.hasStarted && typeof root.onStateEntered === 'function') {
        try {
          root.onStateEntered();
        } catch (_) {}
      }
      if (!frame.hasStarted) {
        frame.hasStarted = true;
      }
    }
  }

  detachStateMachine(frameId: string): void {
    const frame = this.stack.find((f) => f.frameId === frameId);
    if (!frame) return;
    if (frame.stateMachine && frame.stateMachine.rootStateMachine) {
      try {
        frame.stateMachine.rootStateMachine.active = false;
      } catch (_) {}
    }
    if (frame.stateMachineListener) {
      try {
        this.bot.removeListener('physicTick', frame.stateMachineListener);
        this.bot.removeListener('physicsTick', frame.stateMachineListener);
      } catch (_) {}
    }
    frame.stateMachine = null;
    frame.stateMachineListener = null;
  }

  private releaseFrame(frame: BehaviorFrame): void {
    if (frame.stateMachine && frame.stateMachine.rootStateMachine) {
      try {
        frame.stateMachine.rootStateMachine.active = false;
      } catch (_) {}
    }
    if (frame.stateMachineListener) {
      try {
        this.bot.removeListener('physicTick', frame.stateMachineListener);
        this.bot.removeListener('physicsTick', frame.stateMachineListener);
      } catch (_) {}
    }
    for (const handler of frame.cleanupListeners.splice(0)) {
      try {
        handler();
      } catch (_) {}
    }
    for (const plannerId of frame.plannerHandlers.keys()) {
      this.plannerIndex.delete(plannerId);
    }
    frame.plannerHandlers.clear();
    frame.stateMachine = null;
    frame.stateMachineListener = null;
    frame.rootStateMachine = null;
    frame.hasStarted = false;
  }

  private createContext(frame: BehaviorFrame): BehaviorFrameContext {
    return {
      bot: this.bot,
      scheduler: this,
      workerManager: this.workerManager,
      frameId: frame.frameId,
      type: frame.behavior.type,
      name: frame.behavior.name,
      attachStateMachine: (stateMachine, listener) => this.attachStateMachine(frame.frameId, stateMachine, listener),
      detachStateMachine: () => this.detachStateMachine(frame.frameId),
      attachCleanup: (cleanup) => this.attachCleanup(frame.frameId, cleanup),
      attachPlannerHandler: (plannerId, handler) => {
        const key = plannerId || '__default__';
        frame.plannerHandlers.set(key, { plannerId: key, handler });
        this.plannerIndex.set(key, frame.frameId);
      },
      detachPlannerHandler: (plannerId) => {
        const key = plannerId || '__default__';
        frame.plannerHandlers.delete(key);
        this.plannerIndex.delete(key);
      }
    };
  }

  private nextFrameId(): string {
    frameCounter += 1;
    return `frame_${frameCounter}`;
  }
}


