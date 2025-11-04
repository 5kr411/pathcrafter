const { BotStateMachine } = require('mineflayer-statemachine');
import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import logger from '../../utils/logger';
import { Bot, Target, InventoryObject } from './config';
import { captureSnapshotForTarget } from './snapshot_manager';
import { WorkerManager } from './worker_manager';
import { createExecutionContext } from './execution_context';

const INVENTORY_CHECK_DELAY_MS = 250;
const MAX_INVENTORY_CHECK_ATTEMPTS = 5;

function getInventoryObject(bot: Bot): InventoryObject {
  const out: InventoryObject = {};
  try {
    const items = bot.inventory?.items() || [];
    for (const it of items) {
      if (!it || !it.name || !Number.isFinite(it.count)) continue;
      out[it.name] = (out[it.name] || 0) + it.count;
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

export class ToolReplacementExecutor {
  private active = false;
  private target: Target | null = null;
  private botStateMachine: any = null;
  private resolve: ((success: boolean) => void) | null = null;
  private startInventory: InventoryObject = {};
  private requiredGain = 0;
  private inventoryCheckTimeout: NodeJS.Timeout | null = null;
  private startDurableCount = 0;

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
    }
  ) {}

  isActive(): boolean {
    return this.active;
  }

  async executeReplacement(toolName: string): Promise<boolean> {
    if (!toolName || typeof toolName !== 'string') {
      logger.debug('ToolReplacementExecutor: invalid tool name');
      return false;
    }

    if (this.active) {
      logger.warn('ToolReplacementExecutor: replacement already in progress, rejecting concurrent request');
      return false;
    }

    if (this.botStateMachine !== null) {
      logger.warn('ToolReplacementExecutor: bot state machine already active, rejecting request');
      return false;
    }

    logger.info(`ToolReplacementExecutor: starting replacement for ${toolName}`);

    this.active = true;
    const startInventory = getInventoryObject(this.bot);
    const existingCount = startInventory[toolName] || 0;
    const desiredGain = 1;
    const desiredTotal = existingCount + desiredGain;

    this.startInventory = { ...startInventory };
    this.target = { item: toolName, count: desiredTotal };
    this.requiredGain = desiredGain;
    this.startDurableCount = countDurableTools(this.bot, toolName, this.config.toolDurabilityThreshold);

    return await new Promise<boolean>((resolve) => {
      this.resolve = resolve;
      this.startPlanning();
    });
  }

  private startPlanning(): void {
    if (!this.target) {
      this.finish(false);
      return;
    }

    const inventoryMap = new Map(Object.entries(this.startInventory));

    captureSnapshotForTarget(
      this.bot,
      this.target,
      inventoryMap,
      this.config.snapshotRadii,
      this.config.snapshotYHalf,
      this.config.pruneWithWorld,
      this.config.combineSimilarNodes
    )
      .then((result) => {
        const snapshot = result.snapshot;
        const version = this.bot.version || '1.20.1';
        const id = `tool_replacement_${Date.now()}_${Math.random()}`;
        logger.debug(`ToolReplacementExecutor: creating planning job with id ${id}`);

        this.workerManager.postPlanningRequest(
          id,
          this.target!,
          snapshot,
          this.startInventory,
          version,
          this.config.perGenerator,
          this.config.pruneWithWorld,
          this.config.combineSimilarNodes,
          (_entry, ranked, ok, error) => {
            this.handlePlanningResult(ranked, ok, error);
          }
        );
      })
      .catch((err: any) => {
        logger.info(`ToolReplacementExecutor: snapshot capture failed - ${err?.message || err}`);
        this.finish(false);
      });
  }

  handlePlanningResult(ranked: any[], ok: boolean, error?: string): void {
    if (!this.active) {
      return;
    }

    if (!ok) {
      const errorMsg = error ? String(error) : 'unknown error';
      logger.info(`ToolReplacementExecutor: planning failed - ${errorMsg}`);
      this.finish(false);
      return;
    }

    if (!Array.isArray(ranked) || ranked.length === 0) {
      logger.info('ToolReplacementExecutor: planning produced no paths');
      this.finish(false);
      return;
    }

    const best = ranked[0];
    const targetDesc = this.target ? `${this.target.item} x${this.target.count}` : 'tool';
    logger.info(`ToolReplacementExecutor: executing plan with ${best.length} steps for ${targetDesc}`);

    if (best.length === 0) {
      if (this.validateSuccess()) {
        this.finish(true);
      } else {
        logger.info('ToolReplacementExecutor: empty plan but requirement not satisfied');
        this.finish(false);
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
          this.finishExecution(success);
        },
        executionContext
      );
      this.botStateMachine = new BotStateMachine(this.bot, sm);
    } catch (err: any) {
      logger.info(`ToolReplacementExecutor: failed to start execution - ${err?.message || err}`);
      this.finish(false);
    }
  }

  private finishExecution(success: boolean): void {
    logger.info(`ToolReplacementExecutor: finishExecution called (success=${success})`);
    this.logInventoryState('finishExecution');
    if (this.tryFinalizeSuccess()) {
      if (!success) {
        logger.warn('ToolReplacementExecutor: execution reported failure but inventory requirement is satisfied');
      }
      return;
    }

    if (!success) {
      logger.info('ToolReplacementExecutor: execution reported failure, waiting for inventory confirmation');
      this.logInventoryState('waiting-after-failure');
      this.scheduleInventoryValidation(0);
      return;
    }

    logger.info('ToolReplacementExecutor: awaiting inventory update before finalizing');
    this.logInventoryState('waiting-after-success');
    this.scheduleInventoryValidation(0);
  }

  private tryFinalizeSuccess(): boolean {
    const validated = this.validateSuccess();
    logger.info(`ToolReplacementExecutor: tryFinalizeSuccess validation=${validated}`);
    if (!validated) {
      return false;
    }

    this.emitSuccessAnnouncement();
    this.finish(true);
    return true;
  }

  private emitSuccessAnnouncement(): void {
    if (!this.target) return;

    const invNow = getInventoryObject(this.bot);
    const startCount = this.startInventory[this.target.item] || 0;
    const currentCount = invNow[this.target.item] || 0;
    const gained = currentCount - startCount;
    const durableNow = countDurableTools(this.bot, this.target.item, this.config.toolDurabilityThreshold);
    const durableGain = durableNow - this.startDurableCount;
    const announcedGain = gained > 0 ? gained : durableGain > 0 ? durableGain : 0;

    if (announcedGain > 0) {
      logger.info(`ToolReplacementExecutor: collected ${this.target.item} x${announcedGain}`);
      this.safeChat(`collected ${this.target.item} x${announcedGain}`);
    } else {
      logger.info(`ToolReplacementExecutor: success confirmed but no gain detected for ${this.target.item}`);
    }
  }

  private scheduleInventoryValidation(attempt: number): void {
    if (attempt >= MAX_INVENTORY_CHECK_ATTEMPTS) {
      logger.info('ToolReplacementExecutor: inventory update not observed, marking replacement as failed');
      this.finish(false);
      return;
    }

    if (this.inventoryCheckTimeout) {
      clearTimeout(this.inventoryCheckTimeout);
      this.inventoryCheckTimeout = null;
    }

    logger.info(`ToolReplacementExecutor: scheduling inventory validation attempt ${attempt + 1}/${MAX_INVENTORY_CHECK_ATTEMPTS}`);
    this.inventoryCheckTimeout = setTimeout(() => {
      this.inventoryCheckTimeout = null;

      if (!this.active) {
        logger.info('ToolReplacementExecutor: inventory validation fired but executor no longer active');
        return;
      }

      logger.info(`ToolReplacementExecutor: running inventory validation attempt ${attempt + 1}`);
      this.logInventoryState(`validation-attempt-${attempt + 1}`);
      if (this.tryFinalizeSuccess()) {
        return;
      }

      this.scheduleInventoryValidation(attempt + 1);
    }, INVENTORY_CHECK_DELAY_MS);
  }

  private validateSuccess(): boolean {
    try {
      if (!this.target) return false;
      const invNow = getInventoryObject(this.bot);
      const startCount = this.startInventory[this.target.item] || 0;
      const currentCount = invNow[this.target.item] || 0;
      const gained = currentCount - startCount;
      const requiredGain = this.requiredGain > 0
        ? this.requiredGain
        : Math.max(0, this.target.count - startCount);
      const durableNow = countDurableTools(this.bot, this.target.item, this.config.toolDurabilityThreshold);
      const durableGain = durableNow - this.startDurableCount;
      logger.info(
        `ToolReplacementExecutor: validation for ${this.target.item} - start: ${startCount}, current: ${currentCount}, gained: ${gained}, requiredGain: ${requiredGain}, durableGain: ${durableGain}`
      );
      const gainedSatisfied = requiredGain > 0 && gained >= requiredGain;
      const durableSatisfied = durableGain > 0;
      return gainedSatisfied || durableSatisfied;
    } catch (err: any) {
      logger.debug(`ToolReplacementExecutor: error validating success: ${err?.message || err}`);
      return false;
    }
  }

  private finish(success: boolean): void {
    this.logInventoryState(`finish(${success})`);
    if (this.inventoryCheckTimeout) {
      clearTimeout(this.inventoryCheckTimeout);
      this.inventoryCheckTimeout = null;
    }

    if (this.botStateMachine && typeof this.botStateMachine.stop === 'function') {
      try {
        this.botStateMachine.stop();
      } catch (_) {}
    }

    this.botStateMachine = null;
    this.target = null;
    this.startInventory = {};
    this.requiredGain = 0;
    this.active = false;
    this.startDurableCount = 0;

    const resolve = this.resolve;
    this.resolve = null;

    if (resolve) {
      try {
        resolve(success);
      } catch (err: any) {
        logger.debug(`ToolReplacementExecutor: error resolving promise: ${err?.message || err}`);
      }
    }
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    logger.debug('ToolReplacementExecutor: stopping');
    this.finish(false);
  }

  private logInventoryState(label: string): void {
    const targetItem = this.target?.item;
    const invNow = getInventoryObject(this.bot);
    const startCount = targetItem ? this.startInventory[targetItem] || 0 : null;
    const currentCount = targetItem ? invNow[targetItem] || 0 : null;
    logger.info(
      `ToolReplacementExecutor: [${label}] target=${targetItem ?? 'none'} start=${startCount ?? 'n/a'} current=${currentCount ?? 'n/a'} requiredGain=${this.requiredGain}`
    );
  }
}

