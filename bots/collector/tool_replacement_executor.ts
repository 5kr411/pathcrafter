const { BotStateMachine } = require('mineflayer-statemachine');
import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import logger from '../../utils/logger';
import { Bot, Target, InventoryObject } from './config';
import { captureSnapshotForTarget } from './snapshot_manager';
import { WorkerManager } from './worker_manager';
import { createExecutionContext } from './execution_context';

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

export class ToolReplacementExecutor {
  private active = false;
  private target: Target | null = null;
  private botStateMachine: any = null;
  private resolve: ((success: boolean) => void) | null = null;
  private startInventory: InventoryObject = {};
  private requiredGain = 0;

  constructor(
    private bot: Bot,
    private workerManager: WorkerManager,
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
          this.config.combineSimilarNodes
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
      const executionContext = createExecutionContext(this.config.toolDurabilityThreshold);
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
    const fulfilled = success && this.validateSuccess();
    this.finish(fulfilled);
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
      logger.debug(
        `ToolReplacementExecutor: validation for ${this.target.item} - start: ${startCount}, current: ${currentCount}, gained: ${gained}, requiredGain: ${requiredGain}`
      );
      return gained >= requiredGain && requiredGain > 0;
    } catch (err: any) {
      logger.debug(`ToolReplacementExecutor: error validating success: ${err?.message || err}`);
      return false;
    }
  }

  private finish(success: boolean): void {
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
}

