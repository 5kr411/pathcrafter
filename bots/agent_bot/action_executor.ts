import type { StateBehavior } from 'mineflayer-statemachine';
import logger from '../../utils/logger';

const MAX_CONSECUTIVE_UPDATE_ERRORS = 10;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
  start(bot: any): void;
  update(): void;
  stop(): void;
  isFinished(): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
  result(): any; // ToolResult-shaped
}

export class AgentActionExecutor implements StateBehavior {
  public stateName = 'AgentAction';
  public active = false;

  private current: AgentAction | null = null;
  private currentResolve: ((r: unknown) => void) | null = null;
  private currentSignal: AbortSignal | null = null;
  private abortListener: (() => void) | null = null;
  private cancelled = false;
  private consecutiveUpdateErrors = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
  constructor(private readonly bot: any) {}

  hasWork(): boolean {
    return this.current !== null;
  }

  run(action: AgentAction, signal: AbortSignal): Promise<unknown> {
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
    try {
      this.current.update();
      this.consecutiveUpdateErrors = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
    } catch (err: any) {
      this.consecutiveUpdateErrors++;
      try {
        logger.info(`AgentActionExecutor: ${this.current.name}.update() threw (${this.consecutiveUpdateErrors}/${MAX_CONSECUTIVE_UPDATE_ERRORS}): ${err?.message ?? err}`);
      } catch (_) {}
      if (this.consecutiveUpdateErrors >= MAX_CONSECUTIVE_UPDATE_ERRORS) {
        this.resolveWith({ ok: false, error: `action update failed repeatedly: ${err?.message ?? err}` });
        return;
      }
    }
    if (this.current && this.current.isFinished()) {
      const result = this.current.result();
      try { this.current.stop(); } catch (_) {}
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

  private resolveWith(result: unknown): void {
    const resolve = this.currentResolve;
    if (this.currentSignal && this.abortListener) {
      try { this.currentSignal.removeEventListener('abort', this.abortListener); } catch (_) {}
    }
    this.current = null;
    this.currentResolve = null;
    this.currentSignal = null;
    this.abortListener = null;
    this.cancelled = false;
    this.consecutiveUpdateErrors = 0;
    if (resolve) resolve(result);
  }
}
