import { dropItemTool } from '../../../../../bots/agent_bot/tools/impl/drop_item';

describe('drop_item', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  it('drops specified count of item', async () => {
    const tosses: any[] = [];
    const bot: any = {
      inventory: { items: () => [{ name: 'oak_log', type: 42, count: 10 }] },
      toss: (type: number, meta: any, count: number) => { tosses.push([type, meta, count]); return Promise.resolve(); }
    };
    const r = await dropItemTool.execute({ item: 'oak_log', count: 3 }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).dropped).toBe(3);
    expect(tosses).toEqual([[42, null, 3]]);
  });

  it('drops all of item when count omitted', async () => {
    const tosses: any[] = [];
    const bot: any = {
      inventory: { items: () => [{ name: 'dirt', type: 7, count: 5 }, { name: 'dirt', type: 7, count: 2 }] },
      toss: (type: number, meta: any, count: number) => { tosses.push([type, meta, count]); return Promise.resolve(); }
    };
    const r = await dropItemTool.execute({ item: 'dirt' }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).dropped).toBe(7);
    expect(tosses).toEqual([[7, null, 7]]);
  });

  it('errors when item not in inventory', async () => {
    const bot: any = {
      inventory: { items: () => [] },
      toss: () => Promise.resolve()
    };
    const r = await dropItemTool.execute({ item: 'diamond' }, mkCtx(bot) as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not in inventory/);
  });

  it('errors without item name', async () => {
    const bot: any = { inventory: { items: () => [] }, toss: () => Promise.resolve() };
    const r = await dropItemTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(false);
  });
});
