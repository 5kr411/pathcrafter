import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { _internals as plannerInternals } from '../../planner';
import logger from '../../utils/logger';
import { getInventoryObject, InventoryObject } from '../../utils/inventory';
import { Bot, Target, PendingEntry } from './config';
import { captureSnapshotForTarget } from './snapshot_manager';
import { WorkerManager } from './worker_manager';
import { createExecutionContext, ToolIssue } from './execution_context';
import { BehaviorIdle, NestedStateMachine, StateBehavior, StateTransition } from 'mineflayer-statemachine';
import { ToolReplacementExecutor } from './tool_replacement_executor';
import { isDelayReady, resolveTargetFailure } from './targetExecutorHelpers';

function logInfo(msg: string, ...args: any[]): void {
  logger.info(msg, ...args);
}

function logDebug(msg: string, ...args: any[]): void {
  logger.debug(msg, ...args);
}

const TARGET_BEHAVIOR_PRIORITY = 10;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const SKIP_DELAY_MS = 1000;
const RESTART_DELAY_MS = 3000;

export function createToolIssueHandler(options: {
  toolReplacementExecutor?: ToolReplacementExecutor | null;
  toolsBeingReplaced: Set<string>;
  bot: Bot;
  safeChat: (msg: string) => void;
  schedule?: (fn: () => void) => void;
}): (issue: ToolIssue) => void {
  const {
    toolReplacementExecutor,
    toolsBeingReplaced,
    bot,
    safeChat,
    schedule = (fn: () => void) => setImmediate(fn)
  } = options;

  return (issue: ToolIssue) => {
    if (!toolReplacementExecutor) return;

    const toolLabel = issue.toolName || 'unknown tool';
    if (toolLabel === 'unknown tool') {
      logInfo('Collector: tool issue received without tool name, ignoring');
      return;
    }

    if (toolsBeingReplaced.has(toolLabel)) {
      return;
    }

    if (issue.type === 'requirement') {
      logInfo(
        `Collector: missing required tool ${toolLabel}${issue.blockName ? ` for ${issue.blockName}` : ''}`
      );
    } else {
      logInfo(`Collector: tool durability low - ${toolLabel}`);
    }

    schedule(async () => {
      if (!toolReplacementExecutor || toolsBeingReplaced.has(toolLabel)) {
        return;
      }

      if (issue.type === 'requirement') {
        safeChat(`missing tool, acquiring ${toolLabel}`);
      } else {
        safeChat(`tool low, replacing ${toolLabel}`);
      }

      try {
        const invBefore = getInventoryObject(bot);
        logInfo(
          `Collector: tool replacement starting for ${toolLabel} (inventory=${invBefore[toolLabel] || 0})`
        );
        const success = await toolReplacementExecutor.executeReplacement(toolLabel);
        const invAfter = getInventoryObject(bot);
        logInfo(
          `Collector: tool replacement completed for ${toolLabel} (success=${success}, inventory=${invAfter[toolLabel] || 0})`
        );
        if (success) {
          const msg =
            issue.type === 'requirement'
              ? `acquired ${toolLabel}`
              : `replaced ${toolLabel}`;
          logInfo(`Collector: tool replacement succeeded for ${toolLabel}`);
          safeChat(msg);
        } else {
          logInfo(`Collector: tool replacement failed for ${toolLabel}`);
          safeChat(`failed to replace ${toolLabel}`);
        }
      } catch (err: any) {
        logInfo(`Collector: tool replacement error - ${err?.message || err}`);
      }
    });
  };
}

class TargetPlanState implements StateBehavior {
  public stateName = 'TargetPlan';
  public active = false;
  constructor(private readonly executor: TargetExecutor) {}

  onStateEntered(): void {
    this.active = true;
    this.executor.beginPlanning();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class TargetExecuteState implements StateBehavior {
  public stateName = 'TargetExecute';
  public active = false;
  constructor(private readonly executor: TargetExecutor) {}

  onStateEntered(): void {
    this.active = true;
    this.executor.beginExecution();
  }

  update(): void {
    this.executor.updateExecution();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class TargetSuccessState implements StateBehavior {
  public stateName = 'TargetSuccess';
  public active = false;
  constructor(private readonly executor: TargetExecutor) {}

  onStateEntered(): void {
    this.active = true;
    this.executor.handleTargetSuccess();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class TargetFailureState implements StateBehavior {
  public stateName = 'TargetFailure';
  public active = false;
  constructor(private readonly executor: TargetExecutor) {}

  onStateEntered(): void {
    this.active = true;
    this.executor.handleTargetFailure();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class TargetDelayState implements StateBehavior {
  public stateName = 'TargetDelay';
  public active = false;
  constructor(private readonly executor: TargetExecutor) {}

  onStateEntered(): void {
    this.active = true;
    this.executor.startDelay();
  }

  update(): void {
    this.executor.updateDelay();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class TargetRestartDelayState implements StateBehavior {
  public stateName = 'TargetRestartDelay';
  public active = false;
  constructor(private readonly executor: TargetExecutor) {}

  onStateEntered(): void {
    this.active = true;
    this.executor.beginRestartDelay();
  }

  update(): void {
    this.executor.updateRestartDelay();
  }

  onStateExited(): void {
    this.active = false;
  }
}

export class TargetExecutor implements StateBehavior {
  public stateName = 'TargetLayer';
  public active = false;
  public readonly priority = TARGET_BEHAVIOR_PRIORITY;

  private sequenceTargets: Target[] = [];
  private sequenceIndex = 0;
  private targetRetryCount = new Map<number, number>();
  private running = false;
  private currentTargetStartInventory: InventoryObject = {};
  private activeStateMachine: any = null;
  private toolsBeingReplaced: Set<string>;

  private flowMachine: NestedStateMachine;
  private flowStarted = false;

  private planningOutcome: 'idle' | 'pending' | 'execute' | 'success' | 'failure' = 'idle';
  private planPath: any[] | null = null;
  private planningId: string | null = null;
  private executionDone = false;
  private executionSuccess = false;
  private successHandled = false;
  private forceFailure = false;
  private failureHandled = false;
  private delayUntil = 0;
  private delayReady = false;
  private restartPending = false;
  private restartReady = false;
  private restartDelayUntil = 0;
  private stopRequested = false;

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
    private toolReplacementExecutor?: ToolReplacementExecutor,
    toolsBeingReplaced?: Set<string>
  ) {
    this.toolsBeingReplaced = toolsBeingReplaced ?? new Set<string>();
    const idle = new BehaviorIdle();
    const plan = new TargetPlanState(this);
    const execute = new TargetExecuteState(this);
    const success = new TargetSuccessState(this);
    const failure = new TargetFailureState(this);
    const delay = new TargetDelayState(this);
    const restartDelay = new TargetRestartDelayState(this);

    const transitions: StateTransition[] = [
      new StateTransition({
        parent: idle,
        child: restartDelay,
        name: 'target: idle -> restart',
        shouldTransition: () => this.restartPending
      }),
      new StateTransition({
        parent: idle,
        child: plan,
        name: 'target: idle -> plan',
        shouldTransition: () => this.shouldPlan()
      }),
      new StateTransition({
        parent: plan,
        child: restartDelay,
        name: 'target: plan -> restart',
        shouldTransition: () => this.restartPending
      }),
      new StateTransition({
        parent: plan,
        child: idle,
        name: 'target: plan -> idle (stop)',
        shouldTransition: () => this.stopRequested
      }),
      new StateTransition({
        parent: plan,
        child: execute,
        name: 'target: plan -> execute',
        shouldTransition: () => this.planningOutcome === 'execute'
      }),
      new StateTransition({
        parent: plan,
        child: success,
        name: 'target: plan -> success',
        shouldTransition: () => this.planningOutcome === 'success'
      }),
      new StateTransition({
        parent: plan,
        child: failure,
        name: 'target: plan -> failure',
        shouldTransition: () => this.planningOutcome === 'failure'
      }),
      new StateTransition({
        parent: execute,
        child: restartDelay,
        name: 'target: execute -> restart',
        shouldTransition: () => this.restartPending
      }),
      new StateTransition({
        parent: execute,
        child: idle,
        name: 'target: execute -> idle (stop)',
        shouldTransition: () => this.stopRequested
      }),
      new StateTransition({
        parent: execute,
        child: success,
        name: 'target: execute -> success',
        shouldTransition: () => this.executionDone && this.executionSuccess
      }),
      new StateTransition({
        parent: execute,
        child: failure,
        name: 'target: execute -> failure',
        shouldTransition: () => this.executionDone && !this.executionSuccess
      }),
      new StateTransition({
        parent: success,
        child: restartDelay,
        name: 'target: success -> restart',
        shouldTransition: () => this.restartPending
      }),
      new StateTransition({
        parent: success,
        child: failure,
        name: 'target: success -> failure',
        shouldTransition: () => this.forceFailure
      }),
      new StateTransition({
        parent: success,
        child: idle,
        name: 'target: success -> idle',
        shouldTransition: () => this.successHandled && !this.forceFailure
      }),
      new StateTransition({
        parent: failure,
        child: restartDelay,
        name: 'target: failure -> restart',
        shouldTransition: () => this.restartPending
      }),
      new StateTransition({
        parent: failure,
        child: delay,
        name: 'target: failure -> delay',
        shouldTransition: () => this.failureHandled
      }),
      new StateTransition({
        parent: delay,
        child: restartDelay,
        name: 'target: delay -> restart',
        shouldTransition: () => this.restartPending
      }),
      new StateTransition({
        parent: delay,
        child: idle,
        name: 'target: delay -> idle',
        shouldTransition: () => this.delayReady
      }),
      new StateTransition({
        parent: restartDelay,
        child: idle,
        name: 'target: restart -> idle',
        shouldTransition: () => this.restartReady
      })
    ];

    this.flowMachine = new NestedStateMachine(transitions, idle, null as any);
  }

  hasWork(): boolean {
    return this.running && this.sequenceTargets.length > 0;
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

  startNextTarget(): Promise<void> {
    if (!Array.isArray(this.sequenceTargets) || this.sequenceTargets.length === 0) {
      logDebug('Collector: no targets in sequence');
      return Promise.resolve();
    }
    this.running = true;
    return Promise.resolve();
  }

  onStateEntered(): void {
    this.active = true;
    if (!this.flowStarted) {
      this.flowStarted = true;
      this.flowMachine.onStateEntered();
    }
  }

  update(): void {
    if (!this.active) return;
    if (!this.flowStarted) {
      this.flowStarted = true;
      this.flowMachine.onStateEntered();
    }
    this.flowMachine.update();
  }

  onStateExited(): void {
    this.active = false;
    this.suspend();
  }

  resetAndRestart(): void {
    logInfo('Collector: resetting all targets and restarting from beginning');
    const hasQueuedTargets = Array.isArray(this.sequenceTargets) && this.sequenceTargets.length > 0;

    if (!hasQueuedTargets) {
      this.safeChat('death detected but no queued targets to restart');
      return;
    }

    this.running = true;
    this.sequenceIndex = 0;
    this.targetRetryCount.clear();
    this.restartPending = true;
    this.restartReady = false;
    this.restartDelayUntil = Date.now() + RESTART_DELAY_MS;
    this.clearActiveState();
    this.safeChat('death detected, restarting all targets');
  }

  stop(): void {
    logInfo('Collector: stopping execution');
    this.running = false;
    this.sequenceTargets = [];
    this.sequenceIndex = 0;
    this.targetRetryCount.clear();
    this.clearActiveState();
    this.stopRequested = true;
    this.safeChat('stopped');
  }

  beginPlanning(): void {
    this.stopRequested = false;
    this.forceFailure = false;
    this.successHandled = false;
    this.failureHandled = false;
    this.delayReady = false;
    this.executionDone = false;
    this.executionSuccess = false;
    this.planPath = null;
    this.planningOutcome = 'pending';

    if (!this.running) {
      this.planningOutcome = 'idle';
      return;
    }

    if (!Array.isArray(this.sequenceTargets) || this.sequenceTargets.length === 0) {
      this.planningOutcome = 'idle';
      return;
    }

    if (this.sequenceIndex >= this.sequenceTargets.length) {
      this.completeAllTargets();
      this.planningOutcome = 'idle';
      return;
    }

    const target = this.sequenceTargets[this.sequenceIndex];
    const retryCount = this.targetRetryCount.get(this.sequenceIndex) || 0;

    if (retryCount > 0) {
      logInfo(
        `Collector: retrying target ${this.sequenceIndex + 1}/${this.sequenceTargets.length}: ${target.item} x${target.count} (attempt ${retryCount + 1}/${MAX_RETRIES})`
      );
      this.safeChat(`retrying ${target.item} x${target.count} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    } else {
      logInfo(
        `Collector: starting target ${this.sequenceIndex + 1}/${this.sequenceTargets.length}: ${target.item} x${target.count}`
      );
    }

    const invObj = getInventoryObject(this.bot);
    this.currentTargetStartInventory = { ...invObj };
    const inventoryMap = new Map(Object.entries(invObj));

    const planningId = `target_${Date.now()}_${Math.random()}`;
    this.planningId = planningId;

    Promise.resolve()
      .then(async () => {
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
        logDebug(`Collector: creating planning job with id ${planningId}`);
        logDebug(`Collector: snapshot has radius=${snapshot.radius}, block types=${Object.keys(snapshot.blocks || {}).length}`);
        if (!snapshot.radius || !Number.isFinite(snapshot.radius)) {
          logger.info(`Collector: WARNING - snapshot radius is ${snapshot.radius}, distance filtering may not work correctly!`);
        }

        this.workerManager.postPlanningRequest(
          planningId,
          target,
          snapshot,
          invObj,
          version,
          this.config.perGenerator,
          this.config.pruneWithWorld,
          this.config.combineSimilarNodes,
          (entry, ranked, ok, error) => {
            this.handlePlanningResult(entry, ranked, ok, error);
          }
        );
      })
      .catch((err: any) => {
        logInfo(`Collector: snapshot capture failed - ${err?.message || err}`);
        this.safeChat('snapshot capture failed');
        this.planningOutcome = 'failure';
      });
  }

  private handlePlanningResult(entry: PendingEntry, ranked: any[], ok: boolean, error?: string): void {
    if (!entry?.id || entry.id !== this.planningId) {
      return;
    }

    if (!ok) {
      const errorMsg = error ? String(error) : 'unknown error';
      logger.info(`Collector: planning failed - ${errorMsg}`);
      this.safeChat('planning failed');
      this.planningOutcome = 'failure';
      return;
    }

    if (!Array.isArray(ranked) || ranked.length === 0) {
      const target = entry && entry.target ? entry.target : null;
      const invNow = getInventoryObject(this.bot);
      let have = 0;
      if (target && target.item) {
        const name = String(target.item);
        have = invNow[name] || 0;
      }
      if (target && Number.isFinite(target.count) && have >= target.count) {
        this.safeChat('target already satisfied');
        this.planningOutcome = 'success';
        return;
      }
      this.safeChat('no viable paths found');
      this.planningOutcome = 'failure';
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
        logInfo(`Collector: empty plan but target already satisfied (have ${have}, need ${target.count})`);
        this.safeChat('target already satisfied');
        this.planningOutcome = 'success';
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

    this.planPath = best;
    this.planningOutcome = 'execute';
  }

  beginExecution(): void {
    this.executionDone = false;
    this.executionSuccess = false;
    this.clearActiveState();

    if (!this.planPath || this.planPath.length === 0) {
      this.executionDone = true;
      this.executionSuccess = false;
      return;
    }

    const executionContext = createExecutionContext(
      this.config.toolDurabilityThreshold,
      createToolIssueHandler({
        toolReplacementExecutor: this.toolReplacementExecutor,
        toolsBeingReplaced: this.toolsBeingReplaced,
        bot: this.bot,
        safeChat: this.safeChat
      }),
      this.toolsBeingReplaced
    );

    const sm = buildStateMachineForPath(
      this.bot,
      this.planPath,
      (success: boolean) => {
        this.executionDone = true;
        this.executionSuccess = success;
      },
      executionContext
    );

    this.activeStateMachine = sm;
    if (this.activeStateMachine && typeof this.activeStateMachine.onStateEntered === 'function') {
      try {
        this.activeStateMachine.onStateEntered();
      } catch (_) {}
    }
  }

  updateExecution(): void {
    if (this.activeStateMachine && typeof this.activeStateMachine.update === 'function') {
      try {
        this.activeStateMachine.update();
      } catch (_) {}
    }
  }

  handleTargetSuccess(): void {
    this.successHandled = true;
    this.forceFailure = false;

    if (!this.validateTargetSuccess()) {
      logInfo('Collector: target validation failed, treating as failure');
      this.forceFailure = true;
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

    if (this.sequenceIndex >= this.sequenceTargets.length) {
      this.completeAllTargets();
    }
  }

  handleTargetFailure(): void {
    this.failureHandled = true;
    const retryCount = this.targetRetryCount.get(this.sequenceIndex) || 0;

    const resolution = resolveTargetFailure({
      retryCount,
      maxRetries: MAX_RETRIES,
      now: Date.now(),
      retryDelayMs: RETRY_DELAY_MS,
      skipDelayMs: SKIP_DELAY_MS
    });

    if (resolution.action === 'retry') {
      this.targetRetryCount.set(this.sequenceIndex, resolution.nextRetryCount);
      logInfo(
        `Collector: will retry target ${this.sequenceIndex + 1} (${resolution.nextRetryCount} retries so far)`
      );
      this.delayUntil = resolution.delayUntil;
      return;
    }

    logInfo(`Collector: target ${this.sequenceIndex + 1} failed after ${MAX_RETRIES} attempts, moving to next target`);
    this.safeChat(`target failed after ${MAX_RETRIES} attempts, moving on`);
    this.targetRetryCount.delete(this.sequenceIndex);
    this.sequenceIndex++;
    this.delayUntil = resolution.delayUntil;

    if (this.sequenceIndex >= this.sequenceTargets.length) {
      this.completeAllTargets();
    }
  }

  startDelay(): void {
    this.delayReady = false;
  }

  updateDelay(): void {
    if (this.delayReady) return;
    this.delayReady = isDelayReady(Date.now(), this.delayUntil);
  }

  beginRestartDelay(): void {
    this.restartReady = false;
  }

  updateRestartDelay(): void {
    if (this.restartReady) return;
    if (isDelayReady(Date.now(), this.restartDelayUntil)) {
      this.restartPending = false;
      this.restartReady = true;
    }
  }

  private shouldPlan(): boolean {
    if (!this.running) return false;
    if (!Array.isArray(this.sequenceTargets) || this.sequenceTargets.length === 0) return false;
    if (this.sequenceIndex >= this.sequenceTargets.length) return false;
    if (this.planningOutcome === 'pending') return false;
    return true;
  }

  private validateTargetSuccess(): boolean {
    const target = this.sequenceTargets[this.sequenceIndex];
    if (!target) return false;

    const invNow = getInventoryObject(this.bot);
    const startCount = this.currentTargetStartInventory[target.item] || 0;
    const currentCount = invNow[target.item] || 0;
    const gained = currentCount - startCount;
    const needed = Number.isFinite(target.count) ? target.count : 0;

    logDebug(
      `Collector: validating target ${target.item} - start: ${startCount}, current: ${currentCount}, gained: ${gained}, needed: ${target.count}`
    );

    if (needed <= 0) return true;
    if (currentCount >= needed) return true;
    return gained >= needed;
  }

  private completeAllTargets(): void {
    logInfo('Collector: all targets complete');
    this.safeChat('all targets complete');
    this.running = false;
    this.sequenceTargets = [];
    this.sequenceIndex = 0;
    this.targetRetryCount.clear();
    try {
      this.bot.clearControlStates();
      logDebug('Collector: cleared bot control states');
    } catch (_) {}
  }

  private clearActiveState(): void {
    if (this.activeStateMachine && typeof this.activeStateMachine.onStateExited === 'function') {
      try {
        this.activeStateMachine.onStateExited();
      } catch (_) {}
    }
    this.activeStateMachine = null;
  }

  private suspend(): void {
    try {
      this.bot.clearControlStates();
      logDebug('Collector: cleared bot control states during suspend');
    } catch (_) {}
    try {
      const pathfinder = (this.bot as any)?.pathfinder;
      if (pathfinder && typeof pathfinder.stop === 'function') {
        pathfinder.stop();
      }
    } catch (_) {}
  }
}
