import logger from '../../utils/logger';
import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { Bot, Target, InventoryObject, PendingEntry } from './config';
import { captureSnapshotForTarget } from './snapshot_manager';
import { WorkerManager } from './worker_manager';
import { createExecutionContext } from './execution_context';
import { BehaviorScheduler, ScheduledBehavior, BehaviorFrameContext } from './behavior_scheduler';
import { createTrackedBotStateMachine } from './state_machine_utils';

const INVENTORY_CHECK_DELAY_MS = 250;
const MAX_INVENTORY_CHECK_ATTEMPTS = 5;
const TOOL_REPLACEMENT_PRIORITY = 80;

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

class ToolReplacementBehavior implements ScheduledBehavior {
  readonly type = 'tool-replacement';
  readonly priority = TOOL_REPLACEMENT_PRIORITY;
  readonly id: string;
  readonly name: string;

  private schedulerContext: BehaviorFrameContext | null = null;
  private activeStateMachine: any = null;
  private completionResolver: ((success: boolean) => void) | null = null;
  private readonly completionPromise: Promise<boolean>;
  private finished = false;
  private inventoryCheckTimeout: NodeJS.Timeout | null = null;

  private readonly target: Target;
  private readonly startInventory: InventoryObject;
  private readonly requiredGain: number;
  private readonly startDurableCount: number;
  private readonly mcVersion: string;

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
    toolName: string,
    runId: number
  ) {
    this.id = `tool-replacement-${toolName}-${runId}`;
    this.name = `ToolReplacement:${toolName}`;
    this.startInventory = getInventoryObject(this.bot);
    const existingCount = this.startInventory[toolName] || 0;
    this.requiredGain = 1;
    const desiredTotal = existingCount + this.requiredGain;
    this.target = { item: toolName, count: desiredTotal };
    this.startDurableCount = countDurableTools(this.bot, toolName, this.config.toolDurabilityThreshold);
    this.mcVersion = this.bot.version || '1.20.1';
    this.completionPromise = new Promise<boolean>((resolve) => {
      this.completionResolver = resolve;
    });
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

  async activate(context: BehaviorFrameContext): Promise<void> {
    this.schedulerContext = context;
    await this.startPlanning();
  }

  async onSuspend(context: BehaviorFrameContext): Promise<void> {
    try {
      context.detachStateMachine();
      this.bot.clearControlStates();
    } catch (err: any) {
      logger.debug(`ToolReplacementBehavior: error during suspend - ${err?.message || err}`);
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
    // No-op; completion handled in finish().
  }

  private async startPlanning(): Promise<void> {
    try {
      const inventoryMap = new Map(Object.entries(this.startInventory));
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
      const plannerId = `tool_replacement_${Date.now()}_${Math.random()}`;

      if (this.schedulerContext) {
        this.schedulerContext.attachPlannerHandler(plannerId, (entry, ranked, ok, error) => {
          this.handlePlanningResult(entry, ranked, ok, error);
        });
      }

      this.workerManager.postPlanningRequest(
        plannerId,
        this.target,
        snapshot,
        this.startInventory,
        this.mcVersion,
        this.config.perGenerator,
        this.config.pruneWithWorld,
        this.config.combineSimilarNodes,
        { frameId: this.schedulerContext?.frameId }
      );
    } catch (err: any) {
      logger.info(`ToolReplacementBehavior: snapshot capture failed - ${err?.message || err}`);
      await this.finish(false);
    }
  }

  private handlePlanningResult(entry: PendingEntry, ranked: any[], ok: boolean, error?: string): void {
    if (entry?.id && this.schedulerContext) {
      this.schedulerContext.detachPlannerHandler(entry.id);
    }
    if (this.finished) {
      return;
    }

    if (!ok) {
      const errorMsg = error ? String(error) : 'unknown error';
      logger.info(`ToolReplacementBehavior: planning failed - ${errorMsg}`);
      void this.finish(false);
      return;
    }

    if (!Array.isArray(ranked) || ranked.length === 0) {
      logger.info('ToolReplacementBehavior: planning produced no paths');
      void this.finish(false);
      return;
    }

    const best = ranked[0];
    const targetDesc = `${this.target.item} x${this.target.count}`;
    logger.info(`ToolReplacementBehavior: executing plan with ${best.length} steps for ${targetDesc}`);

    if (best.length === 0) {
      if (this.validateSuccess()) {
        void this.finish(true);
      } else {
        logger.info('ToolReplacementBehavior: empty plan but requirement not satisfied');
        void this.finish(false);
      }
      return;
    }

    try {
      const executionContext = createExecutionContext(
        this.config.toolDurabilityThreshold,
        undefined,
        undefined
      );
      const sm = buildStateMachineForPath(
        this.bot,
        best,
        (success: boolean) => {
          this.finishExecution(success).catch((err: any) => {
            logger.debug(`ToolReplacementBehavior: finishExecution error - ${err?.message || err}`);
          });
        },
        executionContext
      );
      this.activeStateMachine = sm;
      this.bindStateMachine();
    } catch (err: any) {
      logger.info(`ToolReplacementBehavior: failed to start execution - ${err?.message || err}`);
      void this.finish(false);
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

  private async finishExecution(success: boolean): Promise<void> {
    logger.info(`ToolReplacementBehavior: finishExecution called (success=${success})`);
    this.logInventoryState('finishExecution');
    if (await this.tryFinalizeSuccess()) {
      if (!success) {
        logger.warn('ToolReplacementBehavior: execution reported failure but inventory requirement is satisfied');
      }
      return;
    }

    if (!success) {
      logger.info('ToolReplacementBehavior: execution reported failure, waiting for inventory confirmation');
      this.logInventoryState('waiting-after-failure');
      this.scheduleInventoryValidation(0);
      return;
    }

    logger.info('ToolReplacementBehavior: awaiting inventory update before finalizing');
    this.logInventoryState('waiting-after-success');
    this.scheduleInventoryValidation(0);
  }

  private async tryFinalizeSuccess(): Promise<boolean> {
    const validated = this.validateSuccess();
    logger.info(`ToolReplacementBehavior: tryFinalizeSuccess validation=${validated}`);
    if (!validated) {
      return false;
    }

    this.emitSuccessAnnouncement();
    await this.finish(true);
    return true;
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
      logger.info(`ToolReplacementBehavior: collected ${this.target.item} x${announcedGain}`);
      this.safeChat(`collected ${this.target.item} x${announcedGain}`);
    } else {
      logger.info(`ToolReplacementBehavior: success confirmed but no gain detected for ${this.target.item}`);
    }
  }

  private scheduleInventoryValidation(attempt: number): void {
    if (attempt >= MAX_INVENTORY_CHECK_ATTEMPTS) {
      logger.info('ToolReplacementBehavior: inventory update not observed, marking replacement as failed');
      void this.finish(false);
      return;
    }

    if (this.inventoryCheckTimeout) {
      clearTimeout(this.inventoryCheckTimeout);
      this.inventoryCheckTimeout = null;
    }

    logger.info(`ToolReplacementBehavior: scheduling inventory validation attempt ${attempt + 1}/${MAX_INVENTORY_CHECK_ATTEMPTS}`);
    this.inventoryCheckTimeout = setTimeout(() => {
      this.inventoryCheckTimeout = null;

      if (this.finished) {
        logger.info('ToolReplacementBehavior: inventory validation fired but behavior already finished');
        return;
      }

      logger.info(`ToolReplacementBehavior: running inventory validation attempt ${attempt + 1}`);
      this.logInventoryState(`validation-attempt-${attempt + 1}`);
      if (this.validateSuccess()) {
        void this.finish(true);
        return;
      }

      this.scheduleInventoryValidation(attempt + 1);
    }, INVENTORY_CHECK_DELAY_MS);
  }

  private validateSuccess(): boolean {
    try {
      const invNow = getInventoryObject(this.bot);
      const startCount = this.startInventory[this.target.item] || 0;
      const currentCount = invNow[this.target.item] || 0;
      const gained = currentCount - startCount;
      const durableNow = countDurableTools(this.bot, this.target.item, this.config.toolDurabilityThreshold);
      const durableGain = durableNow - this.startDurableCount;
      logger.info(
        `ToolReplacementBehavior: validation for ${this.target.item} - start: ${startCount}, current: ${currentCount}, gained: ${gained}, requiredGain: ${this.requiredGain}, durableGain: ${durableGain}`
      );
      const gainedSatisfied = this.requiredGain > 0 && gained >= this.requiredGain;
      const durableSatisfied = durableGain > 0;
      return gainedSatisfied || durableSatisfied;
    } catch (err: any) {
      logger.debug(`ToolReplacementBehavior: error validating success: ${err?.message || err}`);
      return false;
    }
  }

  private async finish(success: boolean): Promise<void> {
    if (this.finished) {
      return;
    }
    this.finished = true;

    this.logInventoryState(`finish(${success})`);

    if (this.inventoryCheckTimeout) {
      clearTimeout(this.inventoryCheckTimeout);
      this.inventoryCheckTimeout = null;
    }

    if (this.schedulerContext) {
      try {
        this.schedulerContext.detachStateMachine();
      } catch (_) {}
    }

    const context = this.schedulerContext;
    this.schedulerContext = null;
    this.activeStateMachine = null;

    if (context) {
      await context.scheduler.completeFrame(context.frameId, success);
    }

    if (this.completionResolver) {
      try {
        this.completionResolver(success);
      } catch (err: any) {
        logger.debug(`ToolReplacementBehavior: error resolving promise: ${err?.message || err}`);
      }
      this.completionResolver = null;
    }
  }

  private logInventoryState(label: string): void {
    const targetItem = this.target?.item;
    const invNow = getInventoryObject(this.bot);
    const startCount = targetItem ? this.startInventory[targetItem] || 0 : null;
    const currentCount = targetItem ? invNow[targetItem] || 0 : null;
    logger.info(
      `ToolReplacementBehavior: [${label}] target=${targetItem ?? 'none'} start=${startCount ?? 'n/a'} current=${currentCount ?? 'n/a'} requiredGain=${this.requiredGain}`
    );
  }
}

export class ToolReplacementExecutor {
  private runCounter = 0;
  private readonly inFlight = new Set<string>();
  private activeBehavior: ToolReplacementBehavior | null = null;

  constructor(
    private readonly bot: Bot,
    private readonly workerManager: WorkerManager,
    private readonly behaviorScheduler: BehaviorScheduler,
    private readonly safeChat: (msg: string) => void,
    private readonly config: {
      snapshotRadii: number[];
      snapshotYHalf: number | null;
      pruneWithWorld: boolean;
      combineSimilarNodes: boolean;
      perGenerator: number;
      toolDurabilityThreshold: number;
    }
  ) {}

  async executeReplacement(toolName: string): Promise<boolean> {
    if (!toolName || typeof toolName !== 'string') {
      logger.debug('ToolReplacementExecutor: invalid tool name');
      return false;
    }

    if (this.inFlight.has(toolName)) {
      logger.warn('ToolReplacementExecutor: replacement already in progress for tool, rejecting concurrent request');
      return false;
    }

    this.inFlight.add(toolName);
    let behavior: ToolReplacementBehavior | null = null;
    try {
      behavior = new ToolReplacementBehavior(
        this.bot,
        this.workerManager,
        this.safeChat,
        this.config,
        toolName,
        ++this.runCounter
      );
      this.activeBehavior = behavior;

      await this.behaviorScheduler.pushAndActivate(behavior, `tool replacement ${toolName}`);
      const success = await behavior.waitForCompletion();
      if (this.activeBehavior === behavior) {
        this.activeBehavior = null;
      }
      return success;
    } catch (err: any) {
      logger.info(`ToolReplacementExecutor: replacement orchestration failed - ${err?.message || err}`);
      if (behavior && !behavior.isFinished()) {
        await behavior.abort();
      }
      if (this.activeBehavior === behavior) {
        this.activeBehavior = null;
      }
      return false;
    } finally {
      this.inFlight.delete(toolName);
      if (this.activeBehavior && this.activeBehavior.isFinished()) {
        this.activeBehavior = null;
      }
    }
  }

  isActive(): boolean {
    return !!this.activeBehavior && !this.activeBehavior.isFinished();
  }

  stop(): void {
    if (this.activeBehavior && !this.activeBehavior.isFinished()) {
      void this.activeBehavior.abort();
    }
  }
}


