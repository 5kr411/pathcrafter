import { getInventoryTool } from '../../../../../bots/agent_bot/tools/impl/get_inventory';

describe('get_inventory', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  it('returns an inventory map keyed by item name', async () => {
    const bot: any = {
      inventory: {
        items: () => [
          { name: 'oak_log', count: 3 },
          { name: 'dirt', count: 5 },
          { name: 'oak_log', count: 2 }
        ],
        slots: []
      }
    };
    const r = await getInventoryTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).inventory).toEqual({ oak_log: 5, dirt: 5 });
  });

  it('returns empty map when inventory empty', async () => {
    const bot: any = { inventory: { items: () => [], slots: [] } };
    const r = await getInventoryTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).inventory).toEqual({});
  });
});
