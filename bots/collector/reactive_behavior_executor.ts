import logger from '../../utils/logger';
import { Bot } from './reactive_behaviors/types';
import { ReactiveBehaviorRegistry } from './reactive_behavior_registry';
import { createTrackedBotStateMachine } from './state_machine_utils';
import { BehaviorFrameContext, ScheduledBehavior } from './behavior_scheduler';

export interface ReactiveBehaviorExecutor {
  finish(success: boolean): void;
}

const REACTIVE_BEHAVIOR_PRIORITY = 90;

class ReactiveBehaviorRun implements ScheduledBehavior {
  readonly type = 'reactive';
  readonly priority = REACTIVE_BEHAVIOR_PRIORITY;
  readonly id: string;
  readonly name: string;

  private schedulerContext: BehaviorFrameContext | null = null;
  private activeStateMachine: any = null;
  private finished = false;
  private completionResolver: ((success: boolean) => void) | null = null;
  private readonly completionPromise: Promise<boolean>;

  constructor(
    private readonly bot: Bot,
    private readonly behavior: any,
    private readonly manager: ReactiveBehaviorExecutorClass,
    runId: number
  ) {
    const name = behavior?.name ? String(behavior.name) : 'unknown';
    this.id = `reactive-${name}-${runId}`;
    this.name = `Reactive:${name}`;
    this.completionPromise = new Promise<boolean>((resolve) => {
      this.completionResolver = resolve;
    });
  }

  matchesBehavior(behavior: any): boolean {
    return this.behavior === behavior;
  }

  async activate(context: BehaviorFrameContext): Promise<void> {
    this.schedulerContext = context;
    await this.startExecution();
  }

  async onSuspend(context: BehaviorFrameContext): Promise<void> {
    try {
      context.detachStateMachine();
      this.bot.clearControlStates();
    } catch (err: any) {
      logger.debug(`ReactiveBehaviorRun: error during suspend - ${err?.message || err}`);
    }
  }

  async onResume(context: BehaviorFrameContext): Promise<void> {
    this.schedulerContext = context;
    this.rebindActiveStateMachine();
  }

  async onAbort(): Promise<void> {
    await this.finish(false);
  }

  async onComplete(): Promise<void> {
    // No additional completion logic.
  }

  waitForCompletion(): Promise<boolean> {
    return this.completionPromise;
  }

  isFinished(): boolean {
    return this.finished;
  }

  async abort(): Promise<void> {
    await this.finish(false);
  }

  private async startExecution(): Promise<void> {
    try {
      const executor: ReactiveBehaviorExecutor = {
        finish: (success: boolean) => {
          void this.finish(success);
        }
      };

      const stateMachine = await this.behavior.execute(this.bot, executor);

      if (!stateMachine) {
        logger.info(`ReactiveBehaviorRun: behavior ${this.behavior?.name || 'unknown'} returned no state machine`);
        await this.finish(false);
        return;
      }

      this.activeStateMachine = stateMachine;
      this.bindStateMachine();
    } catch (err: any) {
      logger.info(`ReactiveBehaviorRun: failed to start execution - ${err?.message || err}`);
      await this.finish(false);
    }
  }

  private bindStateMachine(): void {
    if (!this.schedulerContext || !this.activeStateMachine) {
      return;
    }
    const tracked = createTrackedBotStateMachine(this.bot, this.activeStateMachine);
    this.schedulerContext.attachStateMachine(tracked.botStateMachine, tracked.listener.bind(this.bot));
  }

  private rebindActiveStateMachine(): void {
    if (!this.schedulerContext || !this.activeStateMachine) {
      return;
    }
    this.bindStateMachine();
  }

  getPriority(): number {
    return Number(this.behavior?.priority ?? 0);
  }

  private async finish(success: boolean): Promise<void> {
    if (this.finished) {
      return;
    }
    this.finished = true;

    if (this.schedulerContext) {
      try {
        this.schedulerContext.detachStateMachine();
      } catch (_) {}
    }

    const context = this.schedulerContext;
    this.schedulerContext = null;
    this.activeStateMachine = null;

    this.manager.notifyRunFinished(this);
    if (context) {
      await context.scheduler.completeFrame(context.frameId, success);
    }

    if (this.completionResolver) {
      try {
        this.completionResolver(success);
      } catch (err: any) {
        logger.debug(`ReactiveBehaviorRun: error resolving promise: ${err?.message || err}`);
      }
      this.completionResolver = null;
    }
  }
}

export class ReactiveBehaviorExecutorClass {
  private currentRun: ReactiveBehaviorRun | null = null;
  public readonly registry: ReactiveBehaviorRegistry;
  private runCounter = 0;

  constructor(
    private readonly bot: Bot,
    registry: ReactiveBehaviorRegistry
  ) {
    this.registry = registry;
  }

  isActive(): boolean {
    return !!this.currentRun && !this.currentRun.isFinished();
  }

  stop(): void {
    if (!this.currentRun) {
      return;
    }
    void this.currentRun.abort();
  }

  async createScheduledRun(behavior: any): Promise<ReactiveBehaviorRun | null> {
    const newPriority = Number(behavior?.priority ?? 0);

    if (this.currentRun) {
      if (!this.currentRun.isFinished()) {
        if (this.currentRun.matchesBehavior(behavior)) {
          return null;
        }

        const currentPriority = this.currentRun.getPriority();

        if (newPriority <= currentPriority) {
          logger.debug(`ReactiveBehaviorExecutor: skipping ${behavior?.name || 'unknown'} because ${this.currentRun.name} (priority ${currentPriority}) is active`);
          return null;
        }

        logger.info(`ReactiveBehaviorExecutor: preempting ${this.currentRun.name} (priority ${currentPriority}) with ${behavior?.name || 'unknown'} (priority ${newPriority})`);
        await this.currentRun.abort();
      }
    }

    const run = new ReactiveBehaviorRun(this.bot, behavior, this, ++this.runCounter);
    this.currentRun = run;
    return run;
  }

  notifyRunFinished(run: ReactiveBehaviorRun): void {
    if (this.currentRun === run) {
      this.currentRun = null;
    }
  }
}


