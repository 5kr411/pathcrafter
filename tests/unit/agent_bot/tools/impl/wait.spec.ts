import { waitTool } from '../../../../../bots/agent_bot/tools/impl/wait';

describe('wait', () => {
  const mkCtx = (signal: AbortSignal) => ({
    bot: {}, signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  it('resolves after the given time', async () => {
    const start = Date.now();
    const r = await waitTool.execute({ seconds: 0.05 }, mkCtx(new AbortController().signal) as any);
    expect(r).toEqual({ ok: true });
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('returns cancelled when aborted mid-wait', async () => {
    const ctrl = new AbortController();
    const p = waitTool.execute({ seconds: 60 }, mkCtx(ctrl.signal) as any);
    setTimeout(() => ctrl.abort(), 10);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.cancelled).toBe(true); expect(r.error).toBe('cancelled'); }
  });

  it('errors on invalid seconds', async () => {
    const r = await waitTool.execute({}, mkCtx(new AbortController().signal) as any);
    expect(r.ok).toBe(false);
  });
});
