import logger from '../../utils/logger';
import { buildNudgeContext } from './idle_nudger_context';

export type SessionStateRef = { readonly state: 'empty' | 'running' | 'idle' | 'dead' };
export type ControlStackRef = { getDesiredMode(): 'idle' | 'reactive' | 'tool' | 'target' | 'agent_action' };

export interface IdleNudgerDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bot is mineflayer-typed elsewhere
  bot: any;
  session: SessionStateRef & { injectSystemNotification(text: string): Promise<void> };
  controlStack: ControlStackRef;
  /** Test seam. Defaults to Date.now. */
  clock?: () => number;
  /** Test seam — when set, internal poll timer is NOT started. */
  poll?: false;
}

const POLL_PERIOD_MS = 5_000;
const FIRST_DELAY_MS = 60_000;
const CAP_MS = 15 * 60_000;

export class IdleNudger {
  private lastActivityAt: number;
  private nudgeCount = 0;
  /** Cumulative offset (ms) from lastActivityAt at which the next nudge should fire. */
  private nextDueOffsetMs = FIRST_DELAY_MS;
  private suppressed = false;
  /** True once the bot has ever had a real goal (user chat or death-respawn).
   *  Distinguishes "fresh spawn, no goal yet" from "had goal, session reset to empty
   *  after the AgentSession idle timer fired" — only the latter should still nudge. */
  private hasGoal = false;
  private lastDebugLogAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly clock: () => number;

  constructor(private readonly deps: IdleNudgerDeps) {
    this.clock = deps.clock ?? Date.now;
    this.lastActivityAt = this.clock();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), POLL_PERIOD_MS);
    // unref so the timer doesn't keep the process alive on its own
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- NodeJS.Timeout's unref is not always typed in all environments
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    logger.info(`IdleNudger: started (poll=${POLL_PERIOD_MS}ms, firstDelay=${FIRST_DELAY_MS}ms, cap=${CAP_MS}ms)`);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Tool returned, control stack non-idle, etc. — resets the idle streak. */
  noteActivity(): void {
    this.lastActivityAt = this.clock();
    this.nudgeCount = 0;
    this.nextDueOffsetMs = FIRST_DELAY_MS;
  }

  /** Player addressed the bot. Un-suppress and reset. */
  noteUserChat(): void {
    this.suppressed = false;
    this.hasGoal = true;
    this.noteActivity();
  }

  /** Bot died and respawned. Un-suppress and reset. */
  noteDeathRespawn(): void {
    this.suppressed = false;
    this.hasGoal = true;
    this.noteActivity();
  }

  /** Model called finish_session. Suppress until external wake. */
  noteFinish(): void {
    this.suppressed = true;
    this.nudgeCount = 0;
    this.nextDueOffsetMs = FIRST_DELAY_MS;
  }

  /** Test-only entry to drive the poll deterministically. */
  tickForTest(): void { this.tick(); }

  /** Throttled per-state-class debug log so we can see WHY ticks aren't firing nudges. */
  private logTickState(reason: string, idleMs: number): void {
    const now = this.clock();
    if (now - this.lastDebugLogAt < 30_000) return;
    this.lastDebugLogAt = now;
    logger.debug(
      `IdleNudger: tick reason=${reason} sess=${this.deps.session.state} ctrl=${this.deps.controlStack.getDesiredMode()} hasGoal=${this.hasGoal} suppressed=${this.suppressed} idleMs=${idleMs} nextDue=${this.nextDueOffsetMs} nudges=${this.nudgeCount}`
    );
  }

  private tick(): void {
    const now = this.clock();
    const idleMs = now - this.lastActivityAt;
    if (this.suppressed) { this.logTickState('suppressed', idleMs); return; }
    const sessState = this.deps.session.state;
    if (sessState === 'dead') {
      this.lastActivityAt = now;
      this.nextDueOffsetMs = FIRST_DELAY_MS;
      this.logTickState('session-dead', 0);
      return;
    }
    if (sessState === 'empty' && !this.hasGoal) {
      this.lastActivityAt = now;
      this.nextDueOffsetMs = FIRST_DELAY_MS;
      this.logTickState('empty-no-goal', 0);
      return;
    }
    if (sessState === 'running') {
      this.lastActivityAt = now;
      this.nudgeCount = 0;
      this.nextDueOffsetMs = FIRST_DELAY_MS;
      this.logTickState('session-running', 0);
      return;
    }
    const ctrlMode = this.deps.controlStack.getDesiredMode();
    if (ctrlMode !== 'idle') {
      this.lastActivityAt = now;
      this.nudgeCount = 0;
      this.nextDueOffsetMs = FIRST_DELAY_MS;
      this.logTickState(`ctrl-${ctrlMode}`, 0);
      return;
    }
    if (idleMs >= this.nextDueOffsetMs) {
      this.fire(now);
      return;
    }
    this.logTickState('counting', idleMs);
  }

  private fire(now: number): void {
    const idleMs = now - this.lastActivityAt;
    const body = buildNudgeContext({
      bot: this.deps.bot,
      idleMs,
      nudgeNumber: this.nudgeCount
    });
    logger.info(`IdleNudger: firing nudge #${this.nudgeCount} after ${Math.floor(idleMs / 1000)}s idle`);
    // We deliberately do NOT update lastActivityAt — the backoff is measured
    // from the start of the idle streak, not from each nudge. Instead, we
    // advance nextDueOffsetMs by the next backoff step (capped at CAP_MS).
    this.nudgeCount++;
    const nextStep = Math.min(FIRST_DELAY_MS * (2 ** this.nudgeCount), CAP_MS);
    this.nextDueOffsetMs += nextStep;
    this.deps.session.injectSystemNotification(body).catch(err => {
      logger.info(`IdleNudger: injectSystemNotification failed: ${err?.message ?? err}`);
    });
  }
}
