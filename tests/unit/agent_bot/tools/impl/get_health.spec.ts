import { getHealthTool } from '../../../../../bots/agent_bot/tools/impl/get_health';

describe('get_health', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  it('returns health/food/saturation', async () => {
    const bot: any = { health: 18, food: 15, foodSaturation: 3.2 };
    const r = await getHealthTool.execute({}, mkCtx(bot) as any);
    expect(r).toEqual({ ok: true, data: { health: 18, food: 15, saturation: 3.2 } });
  });

  it('tolerates undefined values', async () => {
    const r = await getHealthTool.execute({}, mkCtx({}) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ health: undefined, food: undefined, saturation: undefined });
  });
});
