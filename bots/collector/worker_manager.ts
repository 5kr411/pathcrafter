import { Worker } from 'worker_threads';
import * as path from 'path';
import { WorkerMessage, PendingEntry, Target, Snapshot } from './config';
import logger from '../../utils/logger';

function logDebug(msg: string, ...args: any[]): void {
  logger.debug(msg, ...args);
}

export class WorkerManager {
  private worker: Worker | null = null;
  private workerReady: boolean = false;
  private pending = new Map<string, PendingEntry>();

  constructor(
    private onResult: (entry: PendingEntry, ranked: any[], ok: boolean, error?: string) => void,
    private onWorkerError: () => void
  ) {}

  ensureWorker(): Worker {
    if (this.worker && this.workerReady) {
      logDebug('Collector: reusing existing worker');
      return this.worker;
    }
    if (this.worker && !this.workerReady) {
      logDebug('Collector: worker exists but not ready yet');
      return this.worker;
    }
    const workerPath = path.resolve(__dirname, '../../workers/planning_worker.js');
    logDebug(`Collector: creating persistent planning worker at ${workerPath}`);
    this.worker = new Worker(workerPath);
    this.workerReady = true;

    this.worker.on('message', (msg: WorkerMessage) => {
      logDebug(`Collector: worker message received: ${JSON.stringify(msg?.type)}`);
      if (!msg || msg.type !== 'result') {
        logDebug(`Collector: ignoring non-result message`);
        return;
      }
      const entry = this.pending.get(msg.id!);
      this.pending.delete(msg.id!);
      if (!entry) {
        logDebug(`Collector: no pending entry for id ${msg.id}`);
        return;
      }
      logDebug(`Collector: processing result for id ${msg.id}, ok=${msg.ok}`);
      const ranked = Array.isArray(msg.ranked) ? msg.ranked : [];
      logDebug(`Collector: received ${ranked.length} ranked paths`);
      this.onResult(entry, ranked, msg.ok || false, msg.error);
    });

    this.worker.on('error', (err: Error) => {
      logger.info(`Collector: worker error - ${err && err.message ? err.message : err}`);
      this.workerReady = false;
      this.onWorkerError();
    });

    this.worker.on('exit', (code: number) => {
      logDebug(`Collector: worker exited with code ${code}`);
      this.worker = null;
      this.workerReady = false;
      this.pending.clear();
    });

    logDebug('Collector: persistent planning worker created successfully');
    return this.worker;
  }

  postPlanningRequest(
    id: string,
    target: Target,
    snapshot: Snapshot,
    inventory: { [key: string]: number },
    mcVersion: string,
    perGenerator: number,
    pruneWithWorld: boolean,
    combineSimilarNodes: boolean
  ): void {
    this.ensureWorker();
    this.pending.set(id, { snapshot, target });

    const planMessage: WorkerMessage = {
      type: 'plan',
      id,
      mcVersion,
      item: target.item,
      count: target.count,
      inventory,
      snapshot,
      perGenerator,
      pruneWithWorld,
      combineSimilarNodes,
      telemetry: false
    };

    logDebug(`Collector: posting planning message to worker`);
    logDebug(`Collector: inventory contains ${Object.keys(inventory).length} item types`);
    this.worker!.postMessage(planMessage);
  }

  terminate(): void {
    if (this.worker) {
      logDebug('Collector: terminating worker');
      try {
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
      this.workerReady = false;
    }
  }

  clearPending(): void {
    this.pending.clear();
  }
}

