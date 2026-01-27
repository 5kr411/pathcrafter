import logger from '../../utils/logger';
import {
  Bot,
  ReactiveBehavior,
  ReactiveBehaviorState,
  ReactiveBehaviorStopReason
} from './reactive_behaviors/types';
import { ReactiveBehaviorRegistry } from './reactive_behavior_registry';

interface ReactiveBehaviorRunState {
  behavior: ReactiveBehavior;
  stateDef: ReactiveBehaviorState;
  stateMachine: any;
  finished: boolean;
  exitCalled: boolean;
}

class ReactiveBehaviorRun {
  private readonly state: ReactiveBehaviorRunState;

  constructor(private readonly bot: Bot, behavior: ReactiveBehavior, stateDef: ReactiveBehaviorState) {
    this.state = {
      behavior,
      stateDef,
      stateMachine: stateDef.stateMachine,
      finished: false,
      exitCalled: false
    };
  }

  start(): void {
    const machine = this.state.stateMachine;
    if (machine && typeof machine.onStateEntered === 'function') {
      try {
        machine.onStateEntered();
      } catch (_) {}
    }
  }

  update(): void {
    if (this.state.finished) return;
    const machine = this.state.stateMachine;
    if (machine && typeof machine.update === 'function') {
      try {
        machine.update();
      } catch (_) {}
    }
    this.checkForCompletion();
  }

  getBehavior(): ReactiveBehavior {
    return this.state.behavior;
  }

  getPriority(): number {
    return Number(this.state.behavior?.priority ?? 0);
  }

  isFinished(): boolean {
    return this.state.finished;
  }

  abort(reason: ReactiveBehaviorStopReason = 'aborted'): void {
    if ((this.bot as any).pvp && (this.bot as any).pvp.target) {
      try {
        (this.bot as any).pvp.stop();
      } catch (_) {}
    }
    this.finish(false, reason);
  }

  private checkForCompletion(): void {
    if (this.state.finished) return;
    const stateDef = this.state.stateDef;
    const machine = this.state.stateMachine;
    const isFinished = stateDef.isFinished
      ?? (machine && typeof machine.isFinished === 'function' ? machine.isFinished.bind(machine) : null);
    if (isFinished && isFinished()) {
      const success = this.getSuccess();
      this.finish(success, 'completed');
    }
  }

  private getSuccess(): boolean {
    const stateDef = this.state.stateDef;
    const machine = this.state.stateMachine;
    const wasSuccessful = stateDef.wasSuccessful
      ?? (machine && typeof machine.wasSuccessful === 'function' ? machine.wasSuccessful.bind(machine) : null);
    if (wasSuccessful) {
      try {
        return !!wasSuccessful();
      } catch (_) {
        return false;
      }
    }
    return true;
  }

  private invokeStateExited(): void {
    if (this.state.exitCalled) return;
    const machine = this.state.stateMachine;
    if (machine && typeof machine.onStateExited === 'function') {
      try {
        machine.onStateExited();
      } catch (_) {}
    }
    this.state.exitCalled = true;
  }

  private invokeStop(reason: ReactiveBehaviorStopReason): void {
    if (!this.state.stateDef.onStop) return;
    try {
      this.state.stateDef.onStop(reason);
    } catch (_) {}
  }

  private finish(success: boolean, reason: ReactiveBehaviorStopReason): void {
    if (this.state.finished) return;
    this.state.finished = true;
    this.invokeStop(reason);
    this.invokeStateExited();
    if (!success) {
      try {
        this.bot.clearControlStates?.();
      } catch (_) {}
    }
  }
}

export class ReactiveBehaviorManager {
  public stateName = 'ReactiveLayer';
  public active = false;

  private currentRun: ReactiveBehaviorRun | null = null;
  private pendingBehavior: ReactiveBehavior | null = null;
  private starting = false;
  private evaluationPromise: Promise<void> | null = null;
  private candidate: ReactiveBehavior | null = null;
  private enabled = true;

  constructor(private readonly bot: Bot, public readonly registry: ReactiveBehaviorRegistry) {}

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  hasWork(): boolean {
    if (!this.enabled) return false;
    if (this.currentRun && this.currentRun.isFinished()) {
      this.currentRun = null;
      // Clear stale candidate so we re-evaluate after completion.
      this.candidate = null;
    }
    this.kickoffEvaluation();
    return !!this.currentRun || !!this.pendingBehavior || !!this.candidate || this.starting;
  }

  isActive(): boolean {
    return !!this.currentRun && !this.currentRun.isFinished();
  }

  stop(): void {
    if (this.currentRun && !this.currentRun.isFinished()) {
      this.currentRun.abort('aborted');
    }
    this.currentRun = null;
    this.pendingBehavior = null;
    this.candidate = null;
    this.starting = false;
  }

  onStateEntered(): void {
    this.active = true;
  }

  onStateExited(): void {
    this.active = false;
    if (this.currentRun && !this.currentRun.isFinished()) {
      this.currentRun.abort('aborted');
      this.currentRun = null;
    }
  }

  update(): void {
    if (!this.enabled) return;
    this.kickoffEvaluation();

    if (this.starting) {
      return;
    }

    if (this.currentRun) {
      this.currentRun.update();
      if (this.currentRun.isFinished()) {
        this.currentRun = null;
        // Clear any stale candidate so we re-evaluate after state changes (e.g., cooldowns).
        this.candidate = null;
      }
    }

    if (this.currentRun) {
      const candidate = this.candidate;
      if (candidate && candidate !== this.currentRun.getBehavior()) {
        const currentPriority = this.currentRun.getPriority();
        const newPriority = Number(candidate?.priority ?? 0);
        if (newPriority > currentPriority) {
          logger.info(
            `ReactiveBehaviorManager: preempting ${this.currentRun.getBehavior().name} (priority ${currentPriority}) with ${candidate.name || 'unknown'} (priority ${newPriority})`
          );
          this.currentRun.abort('preempted');
          this.currentRun = null;
          this.pendingBehavior = candidate;
        }
      }
    }

    if (!this.currentRun) {
      const next = this.pendingBehavior ?? this.candidate;
      this.pendingBehavior = null;
      if (next) {
        this.startBehavior(next);
      }
    }
  }

  private kickoffEvaluation(): void {
    if (!this.enabled) return;
    if (this.evaluationPromise) return;
    this.evaluationPromise = Promise.resolve()
      .then(async () => this.registry.findActiveBehavior(this.bot))
      .then((behavior) => {
        this.candidate = behavior ?? null;
      })
      .catch((err: any) => {
        logger.debug(`ReactiveBehaviorManager: evaluation error - ${err?.message || err}`);
      })
      .finally(() => {
        this.evaluationPromise = null;
      });
  }

  private startBehavior(behavior: ReactiveBehavior): void {
    this.starting = true;
    Promise.resolve()
      .then(async () => behavior.createState(this.bot))
      .then((state) => {
        if (!state || !state.stateMachine) {
          logger.info(`ReactiveBehaviorManager: behavior ${behavior?.name || 'unknown'} returned no state`);
          this.candidate = null;
          this.pendingBehavior = null;
          return null;
        }
        return state;
      })
      .then((state) => {
        if (!state) return;
        const run = new ReactiveBehaviorRun(this.bot, behavior, state);
        run.start();
        this.currentRun = run;
      })
      .catch((err: any) => {
        logger.info(`ReactiveBehaviorManager: failed to start behavior - ${err?.message || err}`);
        this.candidate = null;
        this.pendingBehavior = null;
      })
      .finally(() => {
        this.starting = false;
      });
  }
}
