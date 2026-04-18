import type { StateBehavior } from 'mineflayer-statemachine';

/**
 * A long-running "sustained" action driven by the control-stack state machine.
 *
 * Tools that need to hold the bot's control for more than a single tick
 * (e.g. pathfinder goals, hunt loops) implement an `AgentAction` and hand
 * it to `AgentActionExecutor.run()`. The executor ticks `update()` on each
 * state-machine tick until `isFinished()` returns true, then resolves the
 * `run()` promise with `result()`.
 *
 * Preemption: when a higher-priority mode (e.g. reactive, target) wins
 * `getDesiredMode()`, the state machine transitions out of `agent_action`.
 * `onStateExited()` fires and surfaces a `preempted` result to the caller.
 */
export interface AgentAction {
  name: string;
  start(bot: any): void;
  update(): void;
  stop(): void;
  isFinished(): boolean;
  result(): any; // ToolResult-shaped
}

export class AgentActionExecutor implements StateBehavior {
  public stateName = 'AgentAction';
  public active = false;

  private current: AgentAction | null = null;
  private currentResolve: ((r: any) => void) | null = null;
  private currentSignal: AbortSignal | null = null;
  private abortListener: (() => void) | null = null;
  private cancelled = false;

  constructor(private readonly bot: any) {}

  hasWork(): boolean {
    return this.current !== null;
  }

  run(action: AgentAction, signal: AbortSignal): Promise<any> {
    if (this.current) throw new Error('AgentActionExecutor already running an action');
    this.current = action;
    this.currentSignal = signal;
    this.cancelled = false;

    if (signal.aborted) {
      // Immediate cancel before the state machine ever ticks.
      this.current = null;
      this.currentSignal = null;
      return Promise.resolve({ ok: false, error: 'cancelled', cancelled: true });
    }

    const onAbort = () => {
      this.cancelled = true;
      try { action.stop(); } catch (_) {}
    };
    this.abortListener = onAbort;
    signal.addEventListener('abort', onAbort, { once: true });

    return new Promise(resolve => { this.currentResolve = resolve; });
  }

  onStateEntered(): void {
    this.active = true;
    if (this.current) {
      try { this.current.start(this.bot); } catch (_) {}
    }
  }

  update(): void {
    if (!this.current) return;
    if (this.cancelled) {
      this.resolveWith({ ok: false, error: 'cancelled', cancelled: true });
      return;
    }
    try { this.current.update(); } catch (_) {}
    if (this.current && this.current.isFinished()) {
      const result = this.current.result();
      this.resolveWith(result);
    }
  }

  onStateExited(): void {
    this.active = false;
    // If we still have an in-flight action, the state machine swapped us out
    // (preemption by a higher-priority mode). Stop the action and report.
    if (this.current && !this.cancelled) {
      try { this.current.stop(); } catch (_) {}
      this.resolveWith({ ok: false, error: 'preempted by higher-priority behavior', preempted: true });
    }
  }

  stop(): void {
    if (this.current) {
      try { this.current.stop(); } catch (_) {}
      this.resolveWith({ ok: false, error: 'stopped', cancelled: true });
    }
  }

  private resolveWith(result: any): void {
    const resolve = this.currentResolve;
    if (this.currentSignal && this.abortListener) {
      try { this.currentSignal.removeEventListener('abort', this.abortListener); } catch (_) {}
    }
    this.current = null;
    this.currentResolve = null;
    this.currentSignal = null;
    this.abortListener = null;
    this.cancelled = false;
    if (resolve) resolve(result);
  }
}
