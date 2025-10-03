import { Worker } from 'worker_threads';

/**
 * Simple worker pool for reusing worker threads
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private available: Worker[] = [];
  private pending: Array<{
    resolve: (worker: Worker) => void;
    reject: (err: Error) => void;
  }> = [];
  private workerPath: string;
  private poolSize: number;
  private terminated = false;

  constructor(workerPath: string, poolSize: number = 3) {
    this.workerPath = workerPath;
    this.poolSize = poolSize;
  }

  /**
   * Initialize the worker pool
   */
  async init(): Promise<void> {
    if (this.workers.length > 0) return;

    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(this.workerPath);
      this.workers.push(worker);
      this.available.push(worker);

      // Handle worker errors by removing from pool
      worker.on('error', () => {
        this.removeWorker(worker);
      });

      worker.on('exit', () => {
        this.removeWorker(worker);
      });
    }
  }

  /**
   * Remove a worker from the pool (due to error or exit)
   */
  private removeWorker(worker: Worker): void {
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) {
      this.workers.splice(idx, 1);
    }

    const availIdx = this.available.indexOf(worker);
    if (availIdx >= 0) {
      this.available.splice(availIdx, 1);
    }
  }

  /**
   * Acquire a worker from the pool
   * Returns a promise that resolves when a worker becomes available
   */
  async acquire(): Promise<Worker> {
    if (this.terminated) {
      throw new Error('Worker pool has been terminated');
    }

    // Ensure pool is initialized
    await this.init();

    // If a worker is available, return it immediately
    if (this.available.length > 0) {
      return this.available.pop()!;
    }

    // Otherwise, wait for a worker to become available
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  /**
   * Release a worker back to the pool
   */
  release(worker: Worker): void {
    if (this.terminated) {
      try {
        worker.terminate();
      } catch (_) {
        // Ignore termination errors
      }
      return;
    }

    // If there are pending requests, give the worker to the next one
    if (this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) {
        next.resolve(worker);
      }
      return;
    }

    // Otherwise, add it back to the available pool
    if (this.workers.includes(worker) && !this.available.includes(worker)) {
      this.available.push(worker);
    }
  }

  /**
   * Execute a task with a worker from the pool
   * Automatically acquires and releases the worker
   */
  async execute<T>(
    task: (worker: Worker) => Promise<T>
  ): Promise<T> {
    const worker = await this.acquire();
    try {
      return await task(worker);
    } finally {
      this.release(worker);
    }
  }

  /**
   * Terminate all workers in the pool
   */
  async terminate(): Promise<void> {
    this.terminated = true;

    // Reject all pending requests
    for (const pending of this.pending) {
      pending.reject(new Error('Worker pool terminated'));
    }
    this.pending = [];

    // Terminate all workers
    const terminationPromises = this.workers.map(worker =>
      worker.terminate().catch(() => {
        // Ignore termination errors
      })
    );

    await Promise.all(terminationPromises);

    this.workers = [];
    this.available = [];
  }

  /**
   * Get current pool statistics
   */
  getStats(): { total: number; available: number; busy: number; pending: number } {
    return {
      total: this.workers.length,
      available: this.available.length,
      busy: this.workers.length - this.available.length,
      pending: this.pending.length,
    };
  }
}

