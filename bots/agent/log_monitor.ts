import * as fs from 'fs';
import { BotStatus } from './summary';

export interface LogEvent {
  type: 'starting' | 'target_complete' | 'target_failed' | 'all_complete' | 'error';
  msg: string;
  ts: number;
}

export class LogMonitor {
  private status: BotStatus;
  private readOffset = 0;
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(event: LogEvent) => void> = [];
  private partial = '';

  constructor(
    private logPath: string,
    botName: string
  ) {
    this.status = {
      botName,
      state: 'starting',
      targetsComplete: [],
      targetsFailed: [],
      errors: [],
      lastActivityTs: Date.now()
    };
  }

  start(): void {
    // Poll periodically since fs.watch can miss rapid writes
    this.pollTimer = setInterval(() => this.readNewLines(), 500);

    try {
      this.watcher = fs.watch(this.logPath, () => this.readNewLines());
    } catch {
      // File might not exist yet; poll will pick it up
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Final read
    this.readNewLines();
  }

  getStatus(): BotStatus {
    return { ...this.status };
  }

  onEvent(cb: (event: LogEvent) => void): void {
    this.listeners.push(cb);
  }

  private emit(event: LogEvent): void {
    for (const cb of this.listeners) {
      cb(event);
    }
  }

  private readNewLines(): void {
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.logPath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size <= this.readOffset) {
        fs.closeSync(fd);
        return;
      }

      const buf = Buffer.alloc(stat.size - this.readOffset);
      fs.readSync(fd, buf, 0, buf.length, this.readOffset);
      this.readOffset = stat.size;
      fs.closeSync(fd);
      fd = undefined;

      const text = this.partial + buf.toString('utf-8');
      const lines = text.split('\n');
      // Last element is either empty (complete line) or a partial
      this.partial = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processLine(line);
      }
    } catch {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
      }
    }
  }

  processLine(line: string): void {
    let parsed: { level?: string; msg?: string; ts?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const msg = parsed.msg || '';
    const ts = parsed.ts ? new Date(parsed.ts).getTime() : Date.now();
    this.status.lastActivityTs = ts;

    if (parsed.level === 'ERROR') {
      this.status.errors.push(msg);
      this.emit({ type: 'error', msg, ts });
    }

    if (msg.startsWith('starting target')) {
      this.status.state = 'running';
      this.emit({ type: 'starting', msg, ts });
    } else if (msg.startsWith('target complete:')) {
      const desc = msg.replace('target complete: ', '');
      this.status.targetsComplete.push(desc);
      this.emit({ type: 'target_complete', msg, ts });
    } else if (msg.match(/^target \d+ failed/)) {
      const desc = msg;
      this.status.targetsFailed.push(desc);
      this.emit({ type: 'target_failed', msg, ts });
    } else if (msg === 'all targets complete') {
      this.status.state = 'complete';
      this.emit({ type: 'all_complete', msg, ts });
    }
  }

  markTimeout(): void {
    this.status.state = 'timeout';
  }

  markFailed(): void {
    if (this.status.state !== 'complete') {
      this.status.state = 'failed';
    }
  }
}
