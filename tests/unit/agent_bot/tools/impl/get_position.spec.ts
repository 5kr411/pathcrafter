import { getPositionTool } from '../../../../../bots/agent_bot/tools/impl/get_position';

describe('get_position', () => {
  const ctxBase = (bot: any) => ({
    bot,
    signal: new AbortController().signal,
    targetExecutor: {},
    agentActionExecutor: {},
    safeChat: () => {}
  });

  it('returns position and dimension', async () => {
    const bot: any = { entity: { position: { x: 1, y: 64, z: -3 } }, game: { dimension: 'overworld' } };
    const r = await getPositionTool.execute({}, ctxBase(bot) as any);
    expect(r).toEqual({ ok: true, data: { x: 1, y: 64, z: -3, dimension: 'overworld' } });
  });

  it('handles missing dimension', async () => {
    const bot: any = { entity: { position: { x: 0, y: 0, z: 0 } } };
    const r = await getPositionTool.execute({}, ctxBase(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).dimension).toBeUndefined();
  });

  it('fails cleanly when bot.entity missing', async () => {
    const bot: any = {};
    const r = await getPositionTool.execute({}, ctxBase(bot) as any);
    expect(r.ok).toBe(false);
  });
});
