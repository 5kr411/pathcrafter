import { collectItemTool } from '../../../../../bots/agent_bot/tools/impl/collect_item';

describe('collect_item', () => {
  it('delegates to targetExecutor and waits for completion', async () => {
    const events: string[] = [];
    const targetExecutor = {
      setTargets: (t: any) => events.push(`setTargets:${JSON.stringify(t)}`),
      startNextTarget: () => { events.push('start'); return Promise.resolve(); },
      isRunning: () => false,
      stop: () => events.push('stop'),
      getTargets: () => [],
      getNoPlanFailures: () => []
    };
    const bot = { version: '1.20.1', inventory: { items: () => [], slots: [] } };
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
      getTargets: () => [{ item: 'oak_log', count: 4 }],
      getNoPlanFailures: () => []
    };
    const ctx: any = {
      bot: { version: '1.20.1', inventory: { items: () => [], slots: [] } },
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

  it('removes its abort listener after successful resolution (no leak)', async () => {
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    const fakeSignal: any = {
      aborted: false,
      addEventListener: (ev: string, fn: any, opts?: any) => { addSpy(ev, fn, opts); },
      removeEventListener: (ev: string, fn: any) => { removeSpy(ev, fn); },
      dispatchEvent: () => true
    };
    const targetExecutor = {
      setTargets: jest.fn(),
      startNextTarget: jest.fn().mockResolvedValue(undefined),
      isRunning: () => false,
      stop: jest.fn(),
      getTargets: () => [],
      getNoPlanFailures: () => []
    };
    const ctx: any = {
      bot: { version: '1.20.1', inventory: { items: () => [], slots: [] } },
      signal: fakeSignal,
      targetExecutor,
      agentActionExecutor: {},
      safeChat: () => {}
    };

    const r = await collectItemTool.execute({ targets: [{ item: 'oak_log', count: 4 }] }, ctx);
    expect(r.ok).toBe(true);

    const abortAdds = addSpy.mock.calls.filter(c => c[0] === 'abort');
    const abortRemoves = removeSpy.mock.calls.filter(c => c[0] === 'abort');
    // Every registered abort listener must be removed on resolution.
    expect(abortRemoves.length).toBe(abortAdds.length);
    // Each listener fn added must appear in removes.
    for (const [, fn] of abortAdds) {
      expect(abortRemoves.some(r => r[1] === fn)).toBe(true);
    }
  });

  it('computes acquired diff and missing counts', async () => {
    const invSnapshots: Array<Array<{ name: string; count: number }>> = [
      [],
      [{ name: 'oak_log', count: 3 }]
    ];
    let call = 0;
    const bot = {
      version: '1.20.1',
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
      getTargets: () => [],
      getNoPlanFailures: () => []
    };
    const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };
    const r = await collectItemTool.execute({ targets: [{ item: 'oak_log', count: 4 }] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as any).acquired).toEqual({ oak_log: 3 });
      expect((r.data as any).missing).toEqual({ oak_log: 1 });
      expect((r.data as any).noPlan).toBeUndefined();
    }
  });

  describe('unknown_item validation', () => {
    function makeExecutor() {
      return {
        setTargets: jest.fn(),
        startNextTarget: jest.fn().mockResolvedValue(undefined),
        isRunning: () => false,
        stop: jest.fn(),
        getTargets: () => [],
        getNoPlanFailures: () => []
      };
    }

    it('rejects single bogus item without invoking the planner', async () => {
      const targetExecutor = makeExecutor();
      const bot = { version: '1.20.1', inventory: { items: () => [], slots: [] } };
      const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };

      const r = await collectItemTool.execute({ targets: [{ item: 'definitely_not_an_item', count: 1 }] }, ctx);

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/^unknown_item/);
        expect(r.error).toContain("'definitely_not_an_item'");
        expect(r.invalidItems).toEqual(['definitely_not_an_item']);
      }
      expect(targetExecutor.setTargets).not.toHaveBeenCalled();
      expect(targetExecutor.startNextTarget).not.toHaveBeenCalled();
    });

    it('rejects whole call when mixing valid and invalid items, listing every invalid name', async () => {
      const targetExecutor = makeExecutor();
      const bot = { version: '1.20.1', inventory: { items: () => [], slots: [] } };
      const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };

      const r = await collectItemTool.execute({
        targets: [
          { item: 'oak_log', count: 4 },
          { item: 'cooked_beef_premium', count: 2 },
          { item: 'definitely_fake', count: 1 },
          { item: 'iron_pickaxe', count: 1 }
        ]
      }, ctx);

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/^unknown_item/);
        expect(r.invalidItems).toEqual(['cooked_beef_premium', 'definitely_fake']);
      }
      expect(targetExecutor.setTargets).not.toHaveBeenCalled();
      expect(targetExecutor.startNextTarget).not.toHaveBeenCalled();
    });

    it('proceeds when all items are valid', async () => {
      const targetExecutor = makeExecutor();
      const bot = { version: '1.20.1', inventory: { items: () => [], slots: [] } };
      const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };

      const r = await collectItemTool.execute({
        targets: [{ item: 'oak_log', count: 4 }, { item: 'iron_pickaxe', count: 1 }]
      }, ctx);

      expect(r.ok).toBe(true);
      expect(targetExecutor.setTargets).toHaveBeenCalled();
    });
  });

  describe('no_plan reporting', () => {
    it('surfaces noPlan failures from executor in data.noPlan', async () => {
      const targetExecutor = {
        setTargets: jest.fn(),
        startNextTarget: jest.fn().mockResolvedValue(undefined),
        isRunning: () => false,
        stop: jest.fn(),
        getTargets: () => [],
        getNoPlanFailures: () => [{ item: 'cooked_beef', count: 1 }]
      };
      const bot = { version: '1.20.1', inventory: { items: () => [], slots: [] } };
      const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };

      const r = await collectItemTool.execute({ targets: [{ item: 'cooked_beef', count: 1 }] }, ctx);

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect((r.data as any).noPlan).toEqual([{ item: 'cooked_beef', count: 1 }]);
        expect((r.data as any).missing).toEqual({ cooked_beef: 1 });
      }
    });

    it('omits data.noPlan when there are no no-plan failures', async () => {
      const targetExecutor = {
        setTargets: jest.fn(),
        startNextTarget: jest.fn().mockResolvedValue(undefined),
        isRunning: () => false,
        stop: jest.fn(),
        getTargets: () => [],
        getNoPlanFailures: () => []
      };
      const bot = { version: '1.20.1', inventory: { items: () => [], slots: [] } };
      const ctx: any = { bot, signal: new AbortController().signal, targetExecutor, agentActionExecutor: {}, safeChat: () => {} };

      const r = await collectItemTool.execute({ targets: [{ item: 'oak_log', count: 1 }] }, ctx);

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect((r.data as any).noPlan).toBeUndefined();
      }
    });
  });
});
