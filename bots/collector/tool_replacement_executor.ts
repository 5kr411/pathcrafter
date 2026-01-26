import logger from '../../utils/logger';
import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { getInventoryObject, InventoryObject } from '../../utils/inventory';
import { Bot, Target, PendingEntry } from './config';
import { captureSnapshotForTarget } from './snapshot_manager';
import { WorkerManager } from './worker_manager';
import { createExecutionContext } from './execution_context';
import { BehaviorIdle, NestedStateMachine, StateBehavior, StateTransition } from 'mineflayer-statemachine';

const INVENTORY_CHECK_DELAY_MS = 250;
const MAX_INVENTORY_CHECK_ATTEMPTS = 5;

function countDurableTools(bot: Bot, toolName: string, threshold: number): number {
  let total = 0;
  try {
    const items = bot.inventory?.items() || [];
    for (const it of items) {
      if (!it || it.name !== toolName) continue;

      const rawCount = Number.isFinite((it as any).count) ? (it as any).count : 1;
      if (!rawCount || rawCount <= 0) continue;
      const itemCount = rawCount;

      if (!Number.isFinite(threshold) || threshold <= 0) {
        total += itemCount;
        continue;
      }

      const registryItems = (bot as any)?.registry?.items ?? {};
      const registryEntry = registryItems[it.type];
      const maxDurabilityCandidate = registryEntry?.maxDurability ?? (it as any)?.maxDurability;
      const maxDurability = Number.isFinite(maxDurabilityCandidate) ? maxDurabilityCandidate : null;

      if (!maxDurability || maxDurability <= 0) {
        total += itemCount;
        continue;
      }

      const used = Number.isFinite((it as any).durabilityUsed) ? (it as any).durabilityUsed : 0;
      const remaining = Math.max(0, maxDurability - used);
      const ratio = remaining / maxDurability;

      if (ratio >= threshold) {
        total += itemCount;
      }
    }
  } catch (_) {}
  return total;
}

interface ToolReplacementRequest {
  toolName: string;
  resolve: (success: boolean) => void;
}

class ToolReplacementTask {
  private readonly startInventory: InventoryObject;
  private readonly target: Target;
  private readonly requiredGain: number;
  private readonly startDurableCount: number;
  private readonly mcVersion: string;
  private readonly stateMachine: NestedStateMachine;

  private planOutcome: 'pending' | 'execute' | 'success' | 'failure' = 'pending';
  private planPath: any[] | null = null;
  private executionDone = false;
  private validationDone = false;
  private validationSuccess = false;
  private finished = false;
  private success = false;
  private activePathState: any = null;
  private validationAttempt = 0;
  private nextValidationAt = 0;

  constructor(
    private readonly bot: Bot,
    private readonly workerManager: WorkerManager,
    private readonly safeChat: (msg: string) => void,
    private readonly config: {
      snapshotRadii: number[];
      snapshotYHalf: number | null;
      pruneWithWorld: boolean;
      combineSimilarNodes: boolean;
      perGenerator: number;
      toolDurabilityThreshold: number;
    },
    toolName: string
  ) {
    this.startInventory = getInventoryObject(this.bot);
    const existingCount = this.startInventory[toolName] || 0;
    this.requiredGain = 1;
    const desiredTotal = existingCount + this.requiredGain;
    this.target = { item: toolName, count: desiredTotal };
    this.startDurableCount = countDurableTools(this.bot, toolName, this.config.toolDurabilityThreshold);
    this.mcVersion = this.bot.version || '1.20.1';

    const enter = new BehaviorIdle();
    const plan = new ToolPlanState(this);
    const execute = new ToolExecuteState(this);
    const validate = new ToolValidateState(this);
    const success = new ToolResultState(this, true);
    const failure = new ToolResultState(this, false);
    const exit = new BehaviorIdle();

    const transitions = [
      new StateTransition({
        parent: enter,
        child: plan,
        name: 'tool-replace: enter -> plan',
        shouldTransition: () => true
      }),
      new StateTransition({
        parent: plan,
        child: execute,
        name: 'tool-replace: plan -> execute',
        shouldTransition: () => this.planOutcome === 'execute'
      }),
      new StateTransition({
        parent: plan,
        child: success,
        name: 'tool-replace: plan -> success',
        shouldTransition: () => this.planOutcome === 'success'
      }),
      new StateTransition({
        parent: plan,
        child: failure,
        name: 'tool-replace: plan -> failure',
        shouldTransition: () => this.planOutcome === 'failure'
      }),
      new StateTransition({
        parent: execute,
        child: validate,
        name: 'tool-replace: execute -> validate',
        shouldTransition: () => this.executionDone
      }),
      new StateTransition({
        parent: validate,
        child: success,
        name: 'tool-replace: validate -> success',
        shouldTransition: () => this.validationDone && this.validationSuccess
      }),
      new StateTransition({
        parent: validate,
        child: failure,
        name: 'tool-replace: validate -> failure',
        shouldTransition: () => this.validationDone && !this.validationSuccess
      }),
      new StateTransition({
        parent: success,
        child: exit,
        name: 'tool-replace: success -> exit',
        shouldTransition: () => this.finished
      }),
      new StateTransition({
        parent: failure,
        child: exit,
        name: 'tool-replace: failure -> exit',
        shouldTransition: () => this.finished
      })
    ];

    this.stateMachine = new NestedStateMachine(transitions, enter, exit);
    (this.stateMachine as any).isFinished = () => this.finished;
    (this.stateMachine as any).wasSuccessful = () => this.success;
  }

  start(): void {
    if (typeof this.stateMachine.onStateEntered === 'function') {
      this.stateMachine.onStateEntered();
    }
  }

  update(): void {
    this.stateMachine.update();
  }

  isFinished(): boolean {
    return this.finished;
  }

  wasSuccessful(): boolean {
    return this.success;
  }

  abort(): void {
    this.finished = true;
    this.success = false;
    this.cleanupPathState();
  }

  beginPlanning(): void {
    this.planOutcome = 'pending';
    this.planPath = null;
    const plannerId = `tool_replacement_${Date.now()}_${Math.random()}`;

    Promise.resolve()
      .then(async () => {
        const inventoryMap = new Map<string, number>(Object.entries(this.startInventory));
        const result = await captureSnapshotForTarget(
          this.bot,
          this.target,
          inventoryMap,
          this.config.snapshotRadii,
          this.config.snapshotYHalf,
          this.config.pruneWithWorld,
          this.config.combineSimilarNodes
        );
        const snapshot = result.snapshot;
        this.workerManager.postPlanningRequest(
          plannerId,
          this.target,
          snapshot,
          this.startInventory,
          this.mcVersion,
          this.config.perGenerator,
          this.config.pruneWithWorld,
          this.config.combineSimilarNodes,
          (entry, ranked, ok, error) => {
            this.handlePlanningResult(entry, ranked, ok, error);
          }
        );
      })
      .catch((err: any) => {
        logger.info(`ToolReplacement: snapshot capture failed - ${err?.message || err}`);
        this.planOutcome = 'failure';
      });
  }

  private handlePlanningResult(_entry: PendingEntry, ranked: any[], ok: boolean, error?: string): void {
    if (!ok) {
      const errorMsg = error ? String(error) : 'unknown error';
      logger.info(`ToolReplacement: planning failed - ${errorMsg}`);
      this.planOutcome = 'failure';
      return;
    }

    if (!Array.isArray(ranked) || ranked.length === 0) {
      logger.info('ToolReplacement: planning produced no paths');
      this.planOutcome = 'failure';
      return;
    }

    const best = ranked[0];
    if (!Array.isArray(best)) {
      this.planOutcome = 'failure';
      return;
    }

    if (best.length === 0) {
      if (this.validateSuccess()) {
        this.planOutcome = 'success';
      } else {
        logger.info('ToolReplacement: empty plan but requirement not satisfied');
        this.planOutcome = 'failure';
      }
      return;
    }

    this.planPath = best;
    this.planOutcome = 'execute';
  }

  beginExecution(): void {
    if (!this.planPath) {
      this.executionDone = true;
      return;
    }

    const executionContext = createExecutionContext(
      this.config.toolDurabilityThreshold,
      undefined,
      undefined
    );

    try {
      const sm = buildStateMachineForPath(
        this.bot,
        this.planPath,
        (success: boolean) => {
          this.executionDone = true;
          if (!success) {
            this.validationSuccess = false;
          }
        },
        executionContext
      );
      this.activePathState = sm;
    } catch (err: any) {
      logger.info(`ToolReplacement: failed to start execution - ${err?.message || err}`);
      this.executionDone = true;
    }
  }

  updateExecution(): void {
    if (this.activePathState && typeof this.activePathState.update === 'function') {
      try {
        this.activePathState.update();
      } catch (_) {}
    }
  }

  beginValidation(): void {
    this.validationAttempt = 0;
    this.validationDone = false;
    this.validationSuccess = false;
    this.nextValidationAt = Date.now();
  }

  updateValidation(): void {
    if (this.validationDone) return;
    const now = Date.now();
    if (now < this.nextValidationAt) return;

    this.validationAttempt += 1;

    if (this.validateSuccess()) {
      this.validationSuccess = true;
      this.validationDone = true;
      return;
    }

    if (this.validationAttempt >= MAX_INVENTORY_CHECK_ATTEMPTS) {
      this.validationSuccess = false;
      this.validationDone = true;
      return;
    }

    this.nextValidationAt = now + INVENTORY_CHECK_DELAY_MS;
  }

  finalizeSuccess(): void {
    this.success = true;
    this.finished = true;
    this.emitSuccessAnnouncement();
    this.cleanupPathState();
  }

  finalizeFailure(): void {
    this.success = false;
    this.finished = true;
    this.cleanupPathState();
  }

  private validateSuccess(): boolean {
    try {
      const invNow = getInventoryObject(this.bot);
      const startCount = this.startInventory[this.target.item] || 0;
      const currentCount = invNow[this.target.item] || 0;
      const gained = currentCount - startCount;
      const durableNow = countDurableTools(this.bot, this.target.item, this.config.toolDurabilityThreshold);
      const durableGain = durableNow - this.startDurableCount;
      const gainedSatisfied = this.requiredGain > 0 && gained >= this.requiredGain;
      const durableSatisfied = durableGain > 0;
      return gainedSatisfied || durableSatisfied;
    } catch (_) {
      return false;
    }
  }

  private emitSuccessAnnouncement(): void {
    const invNow = getInventoryObject(this.bot);
    const startCount = this.startInventory[this.target.item] || 0;
    const currentCount = invNow[this.target.item] || 0;
    const gained = currentCount - startCount;
    const durableNow = countDurableTools(this.bot, this.target.item, this.config.toolDurabilityThreshold);
    const durableGain = durableNow - this.startDurableCount;
    const announcedGain = gained > 0 ? gained : durableGain > 0 ? durableGain : 0;

    if (announcedGain > 0) {
      logger.info(`ToolReplacement: collected ${this.target.item} x${announcedGain}`);
      this.safeChat(`collected ${this.target.item} x${announcedGain}`);
    } else {
      logger.info(`ToolReplacement: success confirmed but no gain detected for ${this.target.item}`);
    }
  }

  private cleanupPathState(): void {
    if (this.activePathState && typeof this.activePathState.onStateExited === 'function') {
      try {
        this.activePathState.onStateExited();
      } catch (_) {}
    }
    this.activePathState = null;
  }
}

class ToolPlanState implements StateBehavior {
  public stateName = 'ToolPlan';
  public active = false;

  constructor(private readonly task: ToolReplacementTask) {}

  onStateEntered(): void {
    this.active = true;
    this.task.beginPlanning();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class ToolExecuteState implements StateBehavior {
  public stateName = 'ToolExecute';
  public active = false;

  constructor(private readonly task: ToolReplacementTask) {}

  onStateEntered(): void {
    this.active = true;
    this.task.beginExecution();
  }

  update(): void {
    this.task.updateExecution();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class ToolValidateState implements StateBehavior {
  public stateName = 'ToolValidate';
  public active = false;

  constructor(private readonly task: ToolReplacementTask) {}

  onStateEntered(): void {
    this.active = true;
    this.task.beginValidation();
  }

  update(): void {
    this.task.updateValidation();
  }

  onStateExited(): void {
    this.active = false;
  }
}

class ToolResultState implements StateBehavior {
  public stateName: string;
  public active = false;

  constructor(private readonly task: ToolReplacementTask, private readonly success: boolean) {
    this.stateName = success ? 'ToolSuccess' : 'ToolFailure';
  }

  onStateEntered(): void {
    this.active = true;
    if (this.success) {
      this.task.finalizeSuccess();
    } else {
      this.task.finalizeFailure();
    }
  }

  onStateExited(): void {
    this.active = false;
  }
}

export class ToolReplacementExecutor implements StateBehavior {
  public stateName = 'ToolReplacementLayer';
  public active = false;

  private readonly queue: ToolReplacementRequest[] = [];
  private readonly inFlight = new Set<string>();
  private currentTask: ToolReplacementTask | null = null;
  private currentRequest: ToolReplacementRequest | null = null;

  constructor(
    private readonly bot: Bot,
    private readonly workerManager: WorkerManager,
    private readonly safeChat: (msg: string) => void,
    private readonly config: {
      snapshotRadii: number[];
      snapshotYHalf: number | null;
      pruneWithWorld: boolean;
      combineSimilarNodes: boolean;
      perGenerator: number;
      toolDurabilityThreshold: number;
    },
    private readonly toolsBeingReplaced?: Set<string>
  ) {}

  executeReplacement(toolName: string): Promise<boolean> {
    if (!toolName || typeof toolName !== 'string') {
      logger.debug('ToolReplacementExecutor: invalid tool name');
      return Promise.resolve(false);
    }

    if (this.inFlight.has(toolName)) {
      logger.warn('ToolReplacementExecutor: replacement already in progress for tool, rejecting concurrent request');
      return Promise.resolve(false);
    }

    this.inFlight.add(toolName);
    if (this.toolsBeingReplaced) {
      this.toolsBeingReplaced.add(toolName);
    }

    return new Promise<boolean>((resolve) => {
      this.queue.push({ toolName, resolve });
    });
  }

  hasWork(): boolean {
    return this.queue.length > 0 || !!this.currentTask;
  }

  isActive(): boolean {
    return !!this.currentTask;
  }

  onStateEntered(): void {
    this.active = true;
  }

  onStateExited(): void {
    this.active = false;
    this.suspend();
  }

  update(): void {
    if (!this.active) return;

    if (!this.currentTask) {
      const next = this.queue.shift();
      if (!next) return;
      this.currentRequest = next;
      this.currentTask = new ToolReplacementTask(
        this.bot,
        this.workerManager,
        this.safeChat,
        this.config,
        next.toolName
      );
      this.currentTask.start();
    }

    if (this.currentTask) {
      this.currentTask.update();
      if (this.currentTask.isFinished()) {
        const success = this.currentTask.wasSuccessful();
        this.resolveCurrent(success);
      }
    }
  }

  stop(): void {
    this.queue.splice(0, this.queue.length);
    if (this.currentTask) {
      this.currentTask.abort();
      this.resolveCurrent(false);
    }
    this.inFlight.clear();
  }

  private resolveCurrent(success: boolean): void {
    if (this.currentRequest) {
      try {
        this.currentRequest.resolve(success);
      } catch (_) {}
      if (this.toolsBeingReplaced) {
        this.toolsBeingReplaced.delete(this.currentRequest.toolName);
      }
    }
    this.currentRequest = null;
    this.currentTask = null;
  }

  private suspend(): void {
    try {
      this.bot.clearControlStates?.();
    } catch (_) {}
    try {
      const pathfinder = (this.bot as any)?.pathfinder;
      if (pathfinder && typeof pathfinder.stop === 'function') {
        pathfinder.stop();
      }
    } catch (_) {}
  }
}
