import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { _internals as plannerInternals } from '../../planner';
import logger from '../../utils/logger';
import { Bot, Target, PendingEntry, InventoryObject } from './config';
import { captureSnapshotForTarget } from './snapshot_manager';
import { WorkerManager } from './worker_manager';
import { createExecutionContext } from './execution_context';
import { ReactiveBehaviorExecutorClass } from './reactive_behavior_executor';
import { ScheduledBehavior, BehaviorFrameContext } from './behavior_scheduler';
import { createTrackedBotStateMachine } from './state_machine_utils';

function logInfo(msg: string, ...args: any[]): void {
  logger.info(msg, ...args);
}

function logDebug(msg: string, ...args: any[]): void {
  logger.debug(msg, ...args);
}

function getInventoryObject(bot: Bot): InventoryObject {
  const out: InventoryObject = {};
  try {
    const items = bot.inventory?.items() || [];
    for (const it of items) {
      if (!it || !it.name || !Number.isFinite(it.count)) continue;
      out[it.name] = (out[it.name] || 0) + it.count;
    }
    
    // Also check armor slots (head:5, torso:6, legs:7, feet:8)
    const armorSlots = [5, 6, 7, 8];
    const slots = bot.inventory?.slots;
    if (Array.isArray(slots)) {
      for (const slotIndex of armorSlots) {
        const item = slots[slotIndex];
        if (item && item.name) {
          out[item.name] = (out[item.name] || 0) + (item.count || 1);
        }
      }
    }
  } catch (_) {}
  return out;
}

// Wrapper to create BotStateMachine with trackable physics tick listener
const TARGET_BEHAVIOR_ID = 'collector-target';
const TARGET_BEHAVIOR_PRIORITY = 10;

export class TargetExecutor implements ScheduledBehavior {
  private sequenceTargets: Target[] = [];
  private sequenceIndex = 0;
  private targetRetryCount = new Map<number, number>();
  private running = false;
  private currentTargetStartInventory: InventoryObject = {};
  private readonly MAX_RETRIES = 3;
  private activeStateMachine: any = null;
  private toolsBeingReplaced = new Set<string>();
  private activeBinding: { botStateMachine: any; listener: (this: Bot) => void } | null = null;
  readonly id = TARGET_BEHAVIOR_ID;
  readonly name = 'CollectorTarget';
  readonly priority = TARGET_BEHAVIOR_PRIORITY;
  readonly type = 'collection';
  private schedulerContext: BehaviorFrameContext | null = null;
  private frameId: string | null = null;

  constructor(
    private bot: Bot,
    private workerManager: WorkerManager,
    private safeChat: (msg: string) => void,
    private config: {
      snapshotRadii: number[];
      snapshotYHalf: number | null;
      pruneWithWorld: boolean;
      combineSimilarNodes: boolean;
      perGenerator: number;
      toolDurabilityThreshold: number;
    },
    private reactiveBehaviorExecutor?: ReactiveBehaviorExecutorClass,
    private toolReplacementExecutor?: any
  ) {}

  async activate(context: BehaviorFrameContext): Promise<void> {
    this.schedulerContext = context;
    this.frameId = context.frameId;
    if (this.activeStateMachine) {
      this.rebindActiveStateMachine();
      return;
    }
    if (!this.running) {
      await this.startNextTarget();
    }
  }

  async onSuspend(_context: BehaviorFrameContext): Promise<void> {
    try {
      if (this.schedulerContext) {
        this.schedulerContext.detachStateMachine();
      }
      if (this.activeBinding) {
        this.activeBinding = null;
      }
      this.bot.clearControlStates();
      logDebug('Collector: cleared bot control states during scheduler suspend');
    } catch (err: any) {
      logDebug(`Collector: error during scheduler suspend: ${err?.message || err}`);
    }
  }

  async onResume(context: BehaviorFrameContext): Promise<void> {
    this.schedulerContext = context;
    this.frameId = context.frameId;
    this.rebindActiveStateMachine();
  }

  async onAbort(_context: BehaviorFrameContext): Promise<void> {
    this.stop();
  }

  async onComplete(): Promise<void> {
    // Target executor does not perform additional completion work here.
  }

  isRunning(): boolean {
    return this.running;
  }

  setTargets(targets: Target[]): void {
    this.sequenceTargets = targets.slice();
    this.sequenceIndex = 0;
    this.targetRetryCount.clear();
  }

  getTargets(): Target[] {
    return this.sequenceTargets;
  }

  private rebindActiveStateMachine(): void {
    if (!this.schedulerContext || !this.activeStateMachine) {
      return;
    }
    const tracked = createTrackedBotStateMachine(this.bot, this.activeStateMachine);
    this.activeBinding = tracked;
    this.schedulerContext.attachStateMachine(tracked.botStateMachine, tracked.listener.bind(this.bot));
  }

  resetAndRestart(): void {
    logInfo('Collector: resetting all targets and restarting from beginning');
    this.running = false;
    if (this.schedulerContext) {
      this.schedulerContext.detachStateMachine();
    }
    
    if (this.reactiveBehaviorExecutor) {
      try {
        this.reactiveBehaviorExecutor.stop();
        logDebug('Collector: stopped reactive behavior executor during reset');
      } catch (err: any) {
        logDebug(`Collector: error stopping reactive behavior executor during reset: ${err?.message || err}`);
      }
    }
    
    if (this.toolReplacementExecutor && this.toolReplacementExecutor.isActive && this.toolReplacementExecutor.isActive()) {
      try {
        this.toolReplacementExecutor.stop();
        logDebug('Collector: stopped tool replacement executor during reset');
      } catch (err: any) {
        logDebug(`Collector: error stopping tool replacement executor during reset: ${err?.message || err}`);
      }
    }
    
    this.toolsBeingReplaced.clear();
    
    if (this.activeStateMachine) {
      try {
        if (typeof this.activeStateMachine.onStateExited === 'function') {
          this.activeStateMachine.onStateExited();
        }
      } catch (_) {}
      this.activeStateMachine = null;
    }
    
    try {
      this.bot.clearControlStates();
    } catch (_) {}
    
    this.workerManager.clearPending();
    const hasQueuedTargets = Array.isArray(this.sequenceTargets) && this.sequenceTargets.length > 0;
    this.sequenceIndex = 0;
    this.targetRetryCount.clear();
    
    if (!hasQueuedTargets) {
      this.safeChat('death detected but no queued targets to restart');
      return;
    }

    this.safeChat('death detected, restarting all targets');

    setTimeout(() => {
      try {
        this.startNextTarget().catch(() => {});
      } catch (_) {}
    }, 3000);
  }

  stop(): void {
    logInfo('Collector: stopping execution');
    this.running = false;
    if (this.schedulerContext) {
      this.schedulerContext.detachStateMachine();
    }
    
    if (this.reactiveBehaviorExecutor) {
      try {
        this.reactiveBehaviorExecutor.stop();
        logDebug('Collector: stopped reactive behavior executor');
      } catch (err: any) {
        logDebug(`Collector: error stopping reactive behavior executor: ${err.message || err}`);
      }
    }
    
    if (this.toolReplacementExecutor && this.toolReplacementExecutor.isActive && this.toolReplacementExecutor.isActive()) {
      try {
        this.toolReplacementExecutor.stop();
        logDebug('Collector: stopped tool replacement executor');
      } catch (err: any) {
        logDebug(`Collector: error stopping tool replacement executor: ${err.message || err}`);
      }
    }
    
    this.toolsBeingReplaced.clear();
    
    if (this.activeStateMachine) {
      try {
        if (typeof this.activeStateMachine.onStateExited === 'function') {
          logDebug('Collector: calling onStateExited on nested state machine');
          this.activeStateMachine.onStateExited();
        }
      } catch (err: any) {
        logDebug(`Collector: error calling onStateExited: ${err.message || err}`);
      }
      this.activeStateMachine = null;
    }
    
    try {
      this.bot.clearControlStates();
      logDebug('Collector: cleared bot control states');
    } catch (err: any) {
      logDebug(`Collector: error clearing control states: ${err.message || err}`);
    }
    
    this.workerManager.clearPending();
    this.sequenceTargets = [];
    this.sequenceIndex = 0;
    this.targetRetryCount.clear();
    this.toolsBeingReplaced.clear();
    this.safeChat('stopped');
  }

  async startNextTarget(): Promise<void> {
    if (this.running) {
      logDebug('Collector: startNextTarget called but already running');
      return;
    }
    if (!Array.isArray(this.sequenceTargets) || this.sequenceTargets.length === 0) {
      logDebug('Collector: no targets in sequence');
      return;
    }
    if (this.sequenceIndex >= this.sequenceTargets.length) {
      logInfo('Collector: all targets complete');
      this.safeChat('all targets complete');
      
      this.running = false;
      
      try {
        this.bot.clearControlStates();
        logDebug('Collector: cleared bot control states');
      } catch (err: any) {
        logDebug(`Collector: error clearing control states: ${err.message || err}`);
      }
      
      this.sequenceTargets = [];
      this.sequenceIndex = 0;
      this.targetRetryCount.clear();
      return;
    }

    const target = this.sequenceTargets[this.sequenceIndex];
    const retryCount = this.targetRetryCount.get(this.sequenceIndex) || 0;
    
    if (retryCount > 0) {
      logInfo(
        `Collector: retrying target ${this.sequenceIndex + 1}/${this.sequenceTargets.length}: ${target.item} x${target.count} (attempt ${retryCount + 1}/${this.MAX_RETRIES})`
      );
      this.safeChat(`retrying ${target.item} x${target.count} (attempt ${retryCount + 1}/${this.MAX_RETRIES})`);
    } else {
      logInfo(
        `Collector: starting target ${this.sequenceIndex + 1}/${this.sequenceTargets.length}: ${target.item} x${target.count}`
      );
    }

    const invObj = getInventoryObject(this.bot);
    this.currentTargetStartInventory = { ...invObj };
    const inventoryMap = new Map(Object.entries(invObj));

    try {
      const result = await captureSnapshotForTarget(
        this.bot,
        target,
        inventoryMap,
        this.config.snapshotRadii,
        this.config.snapshotYHalf,
        this.config.pruneWithWorld,
        this.config.combineSimilarNodes
      );

      const snapshot = result.snapshot;
      const version = this.bot.version || '1.20.1';
      const id = `${Date.now()}_${Math.random()}`;
      logDebug(`Collector: creating planning job with id ${id}`);
      logDebug(`Collector: snapshot has radius=${snapshot.radius}, block types=${Object.keys(snapshot.blocks || {}).length}`);
      if (!snapshot.radius || !Number.isFinite(snapshot.radius)) {
        logger.info(`Collector: WARNING - snapshot radius is ${snapshot.radius}, distance filtering may not work correctly!`);
      }

      this.running = true;
      if (this.schedulerContext) {
        this.schedulerContext.attachPlannerHandler(id, (pending, rankedResult, okResult, errResult) => {
          this.handlePlanningResult(pending, rankedResult, okResult, errResult);
        });
      }
      this.workerManager.postPlanningRequest(
        id,
        target,
        snapshot,
        invObj,
        version,
        this.config.perGenerator,
        this.config.pruneWithWorld,
        this.config.combineSimilarNodes,
        { frameId: this.frameId ?? undefined }
      );
    } catch (err: any) {
      logInfo(`Collector: snapshot capture failed - ${err.message || err}`);
      this.safeChat('snapshot capture failed');
      this.running = false;
      this.handleTargetFailure();
    }
  }

  handlePlanningResult(entry: PendingEntry, ranked: any[], ok: boolean, error?: string): void {
    if (entry?.id && this.schedulerContext) {
      this.schedulerContext.detachPlannerHandler(entry.id);
    }
    if (!ok) {
      this.running = false;
      const errorMsg = error ? String(error) : 'unknown error';
      logger.info(`Collector: planning failed - ${errorMsg}`);
      this.safeChat('planning failed');
      this.handleTargetFailure();
      return;
    }

    if (ranked.length === 0) {
      try {
        const target = entry && entry.target ? entry.target : null;
        const invNow = getInventoryObject(this.bot);
        let have = 0;
        if (target && target.item) {
          const name = String(target.item);
          have = invNow[name] || 0;
        }
        if (target && Number.isFinite(target.count) && have >= target.count) {
          this.running = false;
          this.safeChat('target already satisfied');
          this.handleTargetSuccess();
          return;
        }
      } catch (_) {}
      this.running = false;
      this.safeChat('no viable paths found');
      this.handleTargetFailure();
      return;
    }

    const best = ranked[0];
    const target = entry && entry.target ? entry.target : null;
    const targetDesc = target ? `${target.item} x${target.count}` : 'unknown target';
    logInfo(`Collector: executing plan with ${best.length} steps for ${targetDesc}`);
    
    if (best.length === 0) {
      const invNow = getInventoryObject(this.bot);
      let have = 0;
      if (target && target.item) {
        have = invNow[target.item] || 0;
      }
      if (target && Number.isFinite(target.count) && have >= target.count) {
        this.running = false;
        logInfo(`Collector: empty plan but target already satisfied (have ${have}, need ${target.count})`);
        this.safeChat('target already satisfied');
        this.targetRetryCount.delete(this.sequenceIndex);
        this.sequenceIndex++;
        try {
          this.startNextTarget();
        } catch (_) {}
        return;
      }
    }
    
    this.safeChat(`executing plan with ${best.length} steps for ${targetDesc}`);
    
    try {
      const resolved = best.map((s: any) => s);
      logger.info('Collector: selected path (resolved):');
      if (plannerInternals && typeof plannerInternals.logActionPath === 'function') {
        plannerInternals.logActionPath(resolved);
      } else {
        logger.info(JSON.stringify(resolved));
      }
    } catch (_) {}
    
    const executionContext = createExecutionContext(
      this.config.toolDurabilityThreshold,
      (issue) => {
        if (!this.toolReplacementExecutor) return;
        
        logInfo(`Collector: tool issue detected - ${issue.toolName}`);
        
        setImmediate(async () => {
          if (!this.toolReplacementExecutor || this.toolsBeingReplaced.has(issue.toolName)) {
            return;
          }
          
          this.safeChat(`tool low, replacing ${issue.toolName}`);
          this.toolsBeingReplaced.add(issue.toolName);
          
          try {
            const invBefore = getInventoryObject(this.bot);
            logInfo(
              `Collector: tool replacement starting for ${issue.toolName} (inventory=${invBefore[issue.toolName] || 0})`
            );
            const success = await this.toolReplacementExecutor.executeReplacement(issue.toolName);
            const invAfter = getInventoryObject(this.bot);
            logInfo(
              `Collector: tool replacement completed for ${issue.toolName} (success=${success}, inventory=${invAfter[issue.toolName] || 0})`
            );
            if (success) {
              logInfo(`Collector: tool replacement succeeded for ${issue.toolName}`);
              this.safeChat(`replaced ${issue.toolName}`);
            } else {
              logInfo(`Collector: tool replacement failed for ${issue.toolName}`);
              this.safeChat(`failed to replace ${issue.toolName}`);
            }
          } catch (err: any) {
            logInfo(`Collector: tool replacement error - ${err?.message || err}`);
          } finally {
            this.toolsBeingReplaced.delete(issue.toolName);
          }
        });
      },
      this.toolsBeingReplaced
    );
    
    const sm = buildStateMachineForPath(
      this.bot,
      best,
      (success: boolean) => {
        this.running = false;
        this.activeStateMachine = null;
        this.activeBinding = null;
        if (this.schedulerContext) {
          this.schedulerContext.detachStateMachine();
        }
        if (success) {
          this.handleTargetSuccess();
        } else {
          this.safeChat('plan failed');
          this.handleTargetFailure();
        }
      },
      executionContext
    );
    this.activeStateMachine = sm;
    const tracked = createTrackedBotStateMachine(this.bot, sm);
    this.activeBinding = tracked;
    if (this.schedulerContext) {
      this.schedulerContext.attachStateMachine(tracked.botStateMachine, tracked.listener.bind(this.bot));
    }
  }

  private validateTargetSuccess(): boolean {
    const target = this.sequenceTargets[this.sequenceIndex];
    if (!target) return false;

    const invNow = getInventoryObject(this.bot);
    const startCount = this.currentTargetStartInventory[target.item] || 0;
    const currentCount = invNow[target.item] || 0;
    const gained = currentCount - startCount;

    logDebug(`Collector: validating target ${target.item} - start: ${startCount}, current: ${currentCount}, gained: ${gained}, needed: ${target.count}`);

    return gained >= target.count;
  }

  private handleTargetSuccess(): void {
    if (!this.validateTargetSuccess()) {
      logInfo('Collector: target validation failed, treating as failure');
      this.handleTargetFailure();
      return;
    }

    const currentTarget = this.sequenceTargets[this.sequenceIndex];
    if (currentTarget) {
      const completedDesc = `${currentTarget.item} x${currentTarget.count}`;
      logInfo(`Collector: target complete: ${completedDesc}`);
      this.safeChat(`collected ${completedDesc}`);
    }

    this.targetRetryCount.delete(this.sequenceIndex);
    this.sequenceIndex++;
    
    try {
      this.startNextTarget();
    } catch (_) {}
  }

  private handleTargetFailure(): void {
    const retryCount = this.targetRetryCount.get(this.sequenceIndex) || 0;
    
    if (retryCount < this.MAX_RETRIES - 1) {
      this.targetRetryCount.set(this.sequenceIndex, retryCount + 1);
      logInfo(`Collector: will retry target ${this.sequenceIndex + 1} (${retryCount + 1} retries so far)`);
      
      setTimeout(() => {
        try {
          this.startNextTarget();
        } catch (_) {}
      }, 2000);
    } else {
      logInfo(`Collector: target ${this.sequenceIndex + 1} failed after ${this.MAX_RETRIES} attempts, moving to next target`);
      this.safeChat(`target failed after ${this.MAX_RETRIES} attempts, moving on`);
      this.targetRetryCount.delete(this.sequenceIndex);
      this.sequenceIndex++;
      
      setTimeout(() => {
        try {
          this.startNextTarget();
        } catch (_) {}
      }, 1000);
    }
  }
}

