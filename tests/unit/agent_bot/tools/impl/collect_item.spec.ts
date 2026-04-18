import { collectItemTool } from '../../../../../bots/agent_bot/tools/impl/collect_item';

describe('collect_item', () => {
  it('delegates to targetExecutor and waits for completion', async () => {
    const events: string[] = [];
    const targetExecutor = {
      setTargets: (t: any) => events.push(`setTargets:${JSON.stringify(t)}`),
      startNextTarget: () => { events.push('start'); return Promise.resolve(); },
      isRunning: () => false,
      stop: () => events.push('stop'),
      getTargets: () => []
    };
    const bot = { inventory: { items: () => [], slots: [] } };
    const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };

    const r = await collectItemTool.execute({ targets: [{ item: 'oak_log', count: 4 }] }, ctx);
    expect(events[0]).toContain('setTargets');
    expect(r.ok).toBe(true);
  });

  it('cancels via AbortSignal and returns partial', async () => {
    const ctrl = new AbortController();
    let resolveHang: () => void = () => {};
    const hang = new Promise<void>(r => { resolveHang = r; });
    const targetExecutor = {
      setTargets: jest.fn(),
      startNextTarget: jest.fn().mockImplementation(() => hang),
      isRunning: () => true,
      stop: jest.fn().mockImplementation(() => resolveHang()),
      getTargets: () => [{ item: 'oak_log', count: 4 }]
    };
    const ctx: any = {
      bot: { inventory: { items: () => [], slots: [] } },
      signal: ctrl.signal,
      targetExecutor,
      agentActionExecutor: {},
      safeChat: () => {}
    };
    const p = collectItemTool.execute({ targets: [{ item: 'oak_log', count: 4 }] }, ctx);
    ctrl.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cancelled).toBe(true);
      expect(targetExecutor.stop).toHaveBeenCalled();
    }
  });

  it('computes acquired diff and missing counts', async () => {
    const invSnapshots: Array<Array<{ name: string; count: number }>> = [
      [],
      [{ name: 'oak_log', count: 3 }]
    ];
    let call = 0;
    const bot = {
      inventory: {
        items: () => invSnapshots[Math.min(call++, invSnapshots.length - 1)],
        slots: []
      }
    };
    const targetExecutor = {
      setTargets: jest.fn(),
      startNextTarget: jest.fn().mockResolvedValue(undefined),
      isRunning: () => false,
      stop: jest.fn(),
      getTargets: () => []
    };
    const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };
    const r = await collectItemTool.execute({ targets: [{ item: 'oak_log', count: 4 }] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as any).acquired).toEqual({ oak_log: 3 });
      expect((r.data as any).missing).toEqual({ oak_log: 1 });
    }
  });
});
