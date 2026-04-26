export class Lifecycle {
  private finished = false;
  private pendingImmediate: NodeJS.Immediate | null = null;

  constructor(private readonly onFinish: (reason: string) => void) {}

  scheduleFinish(reason: string): void {
    if (this.finished || this.pendingImmediate) return;
    this.pendingImmediate = setImmediate(() => this.finish(reason));
  }

  finish(reason: string): void {
    if (this.finished) return;
    this.finished = true;
    if (this.pendingImmediate) {
      clearImmediate(this.pendingImmediate);
      this.pendingImmediate = null;
    }
    this.onFinish(reason);
  }

  isFinished(): boolean {
    return this.finished;
  }
}
