const { BotStateMachine } = require('mineflayer-statemachine');
import { buildStateMachineForPath } from '../../behavior_generator/buildMachine';
import { _internals as plannerInternals } from '../../planner';
import logger from '../../utils/logger';
import { Bot, Target, PendingEntry, InventoryObject } from './config';
import { captureSnapshotForTarget } from './snapshot_manager';
import { WorkerManager } from './worker_manager';
import { createExecutionContext } from './execution_context';

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
  } catch (_) {}
  return out;
}

export class TargetExecutor {
  private sequenceTargets: Target[] = [];
  private sequenceIndex = 0;
  private targetRetryCount = new Map<number, number>();
  private running = false;
  private currentTargetStartInventory: InventoryObject = {};
  private readonly MAX_RETRIES = 3;
  private activeStateMachine: any = null;
  private activeBotStateMachine: any = null;

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

  resetAndRestart(): void {
    logInfo('Collector: resetting all targets and restarting from beginning');
    this.running = false;
    
    // Remove digging event listeners
    this.removeDiggingListeners();
    
    if (this.activeBotStateMachine) {
      try {
        if (typeof this.activeBotStateMachine.stop === 'function') {
          this.activeBotStateMachine.stop();
        }
      } catch (_) {}
      this.activeBotStateMachine = null;
    }
    
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
    this.sequenceIndex = 0;
    this.targetRetryCount.clear();
    
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
    
    // Remove digging event listeners
    this.removeDiggingListeners();
    
    if (this.activeBotStateMachine) {
      try {
        if (typeof this.activeBotStateMachine.stop === 'function') {
          logDebug('Collector: calling stop on BotStateMachine');
          this.activeBotStateMachine.stop();
        }
      } catch (err: any) {
        logDebug(`Collector: error stopping BotStateMachine: ${err.message || err}`);
      }
      this.activeBotStateMachine = null;
    }
    
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
      this.workerManager.postPlanningRequest(
        id,
        target,
        snapshot,
        invObj,
        version,
        this.config.perGenerator,
        this.config.pruneWithWorld,
        this.config.combineSimilarNodes
      );
    } catch (err: any) {
      logInfo(`Collector: snapshot capture failed - ${err.message || err}`);
      this.safeChat('snapshot capture failed');
      this.running = false;
      this.handleTargetFailure();
    }
  }

  handlePlanningResult(entry: PendingEntry, ranked: any[], ok: boolean, error?: string): void {
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
      this.config.toolDurabilityThreshold
    );
    
    const sm = buildStateMachineForPath(
      this.bot,
      best,
      (success: boolean) => {
        this.running = false;
        
        // Remove digging event listeners
        this.removeDiggingListeners();
        
        this.activeStateMachine = null;
        this.activeBotStateMachine = null;
        if (success) {
          const currentTarget = this.sequenceTargets[this.sequenceIndex];
          const completedDesc = currentTarget ? `${currentTarget.item} x${currentTarget.count}` : 'target';
          this.safeChat(`plan complete: ${completedDesc}`);
          this.handleTargetSuccess();
        } else {
          this.safeChat('plan failed');
          this.handleTargetFailure();
        }
      },
      executionContext
    );
    this.activeStateMachine = sm;
    this.activeBotStateMachine = new BotStateMachine(this.bot, sm);
    
    // Ensure digging event listeners are attached
    this.ensureDiggingListeners();
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

  private onDiggingCompleted = () => {
    logDebug(`Collector: diggingCompleted event (explicit dig complete)`);
  }

  private onDiggingAborted = (block: any) => {
    const blockName = block?.name || 'unknown';
    logDebug(`Collector: digging aborted on ${blockName}`);
  }

  private onDiggingStarted = (block: any) => {
    const blockName = block?.name || 'unknown';
    logDebug(`Collector: digging started on ${blockName} (explicit dig)`);
  }

  private ensureDiggingListeners(): void {
    this.removeDiggingListeners();
    logDebug('Collector: attaching digging event listeners (for explicit digs only)');
    this.bot.on('diggingStarted', this.onDiggingStarted);
    this.bot.on('diggingCompleted', this.onDiggingCompleted);
    this.bot.on('diggingAborted', this.onDiggingAborted);
  }

  private removeDiggingListeners(): void {
    try {
      this.bot.off('diggingCompleted', this.onDiggingCompleted);
      this.bot.off('diggingAborted', this.onDiggingAborted);
      this.bot.off('diggingStarted', this.onDiggingStarted);
      logDebug('Collector: removed digging event listeners');
    } catch (_) {}
  }
}

