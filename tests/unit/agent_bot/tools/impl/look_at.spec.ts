import { lookAtTool } from '../../../../../bots/agent_bot/tools/impl/look_at';

describe('look_at', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  it('looks at coordinates', async () => {
    const looked: any[] = [];
    const bot: any = { lookAt: (pos: any) => { looked.push(pos); return Promise.resolve(); } };
    const r = await lookAtTool.execute({ x: 10, y: 64, z: -5 }, mkCtx(bot) as any);
    expect(r).toEqual({ ok: true });
    expect(looked.length).toBe(1);
    expect(looked[0].x).toBe(10);
    expect(looked[0].y).toBe(64);
    expect(looked[0].z).toBe(-5);
  });

  it('looks at entityId', async () => {
    const looked: any[] = [];
    const bot: any = {
      lookAt: (pos: any) => { looked.push(pos); return Promise.resolve(); },
      entities: { 7: { id: 7, position: { x: 1, y: 2, z: 3 } } }
    };
    const r = await lookAtTool.execute({ entityId: 7 }, mkCtx(bot) as any);
    expect(r).toEqual({ ok: true });
    expect(looked[0].x).toBe(1);
    expect(looked[0].y).toBe(2);
    expect(looked[0].z).toBe(3);
  });

  it('errors when entityId unknown', async () => {
    const bot: any = { lookAt: () => Promise.resolve(), entities: {} };
    const r = await lookAtTool.execute({ entityId: 99 }, mkCtx(bot) as any);
    expect(r.ok).toBe(false);
  });

  it('errors when no input', async () => {
    const bot: any = { lookAt: () => Promise.resolve() };
    const r = await lookAtTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(false);
  });
});
