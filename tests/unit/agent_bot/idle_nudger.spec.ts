import { IdleNudger } from '../../../bots/agent_bot/idle_nudger';

type SessionState = 'empty' | 'running' | 'idle' | 'dead';
type ControlMode = 'idle' | 'reactive' | 'tool' | 'target' | 'agent_action';

function makeFakes() {
  let sessionState: SessionState = 'idle';
  let controlMode: ControlMode = 'idle';
  const injected: string[] = [];
  const session: any = {
    get state() { return sessionState; },
    injectSystemNotification: jest.fn(async (text: string) => { injected.push(text); })
  };
  const controlStack: any = {
    getDesiredMode: () => controlMode
  };
  const bot: any = {
    entity: { position: { x: 1, y: 64, z: 2 } },
    game: { dimension: 'overworld' },
    health: 20,
    food: 18,
    foodSaturation: 4,
    time: { timeOfDay: 6000, day: 3 },
    inventory: { items: () => [] }
  };
  return {
    session,
    controlStack,
    bot,
    injected,
    setSessionState(s: SessionState) { sessionState = s; },
    setControlMode(m: ControlMode) { controlMode = m; }
  };
}

describe('IdleNudger', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => { now = 1_000_000; });

  it('does not nudge before 60s of combined idle', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.tickForTest();
    now += 30_000;
    nudger.tickForTest();
    now += 29_999;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(0);
  });

  it('fires first nudge at idle+60s', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.tickForTest();          // initial sample sets lastActivityAt
    now += 60_000;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(1);
    expect(f.injected[0]).toMatch(/idle-nudge #0/);
  });

  it('backs off: nudges at 60s, 3m, 7m, 15m, 30m, 45m, 60m', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.tickForTest();
    const offsets = [60_000, 180_000, 420_000, 900_000, 1_800_000, 2_700_000, 3_600_000];
    let count = 0;
    for (const off of offsets) {
      now = 1_000_000 + off;
      nudger.tickForTest();
      count++;
      expect(f.injected).toHaveLength(count);
    }
  });

  it('does not nudge while session.state === "running"', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    f.setSessionState('running');
    nudger.tickForTest();
    now += 5 * 60_000;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(0);
  });

  it('does not nudge in "empty" before any goal has arrived', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    f.setSessionState('empty');
    nudger.tickForTest();
    now += 5 * 60_000;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(0);
  });

  it('does not nudge in "dead" session state', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    f.setSessionState('dead');
    nudger.tickForTest();
    now += 5 * 60_000;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(0);
  });

  it('nudges in "empty" state once a goal has been received (post-reset case)', () => {
    // Repro of the live-run regression: AgentSession lands in 'idle' after the
    // model emits text-only output, then its 30s idle timer fires reset() which
    // sets state back to 'empty'. The bot still has unfinished work but the
    // nudger was treating 'empty' as nudge-ineligible.
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.noteUserChat();          // a goal arrived
    f.setSessionState('idle');
    nudger.tickForTest();
    now += 30_000; nudger.tickForTest();
    f.setSessionState('empty');     // simulate AgentSession idle-timer reset
    now += 30_000; nudger.tickForTest();
    expect(f.injected).toHaveLength(1);
    expect(f.injected[0]).toMatch(/idle-nudge #0/);
  });

  it('does not nudge while control stack is non-idle and resets streak', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.tickForTest();
    now += 50_000;
    f.setControlMode('target');
    nudger.tickForTest();          // resets lastActivityAt
    f.setControlMode('idle');
    now += 59_999;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(0);
    now += 1;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(1);
  });

  it('noteUserChat resets streak and clears suppression', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.tickForTest();
    now += 60_000; nudger.tickForTest();
    expect(f.injected).toHaveLength(1);
    nudger.noteFinish();           // suppress
    now += 60_000; nudger.tickForTest();
    expect(f.injected).toHaveLength(1); // still suppressed
    nudger.noteUserChat();          // un-suppress, reset
    now += 59_999; nudger.tickForTest();
    expect(f.injected).toHaveLength(1);
    now += 1; nudger.tickForTest();
    expect(f.injected).toHaveLength(2);
    expect(f.injected[1]).toMatch(/idle-nudge #0/);
  });

  it('noteFinish suppresses; noteDeathRespawn re-arms', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.tickForTest();
    nudger.noteFinish();
    now += 30 * 60_000;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(0);
    nudger.noteDeathRespawn();
    now += 60_000;
    nudger.tickForTest();
    expect(f.injected).toHaveLength(1);
  });

  it('caps backoff at 15 minutes', () => {
    const f = makeFakes();
    const nudger = new IdleNudger({ ...f, clock });
    nudger.tickForTest();
    // Drive past the cap, then verify each subsequent nudge is 15m apart.
    const schedule = [60_000, 180_000, 420_000, 900_000, 1_800_000, 2_700_000];
    for (const off of schedule) {
      now = 1_000_000 + off;
      nudger.tickForTest();
    }
    const before = f.injected.length;
    now += 15 * 60_000 - 1;
    nudger.tickForTest();
    expect(f.injected.length).toBe(before);
    now += 1;
    nudger.tickForTest();
    expect(f.injected.length).toBe(before + 1);
  });
});
