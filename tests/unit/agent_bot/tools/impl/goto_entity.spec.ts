import { gotoEntityTool } from '../../../../../bots/agent_bot/tools/impl/goto_entity';

describe('goto_entity tool', () => {
  it('delegates to agentActionExecutor.run and returns its result', async () => {
    const agentActionExecutor = {
      run: jest.fn().mockResolvedValue({ ok: true, data: { arrivedAt: { x: 1, y: 2, z: 3 } } })
    };
    const ctx: any = {
      bot: { entity: { position: { x: 0, y: 64, z: 0 } }, entities: { 42: { position: { x: 5, y: 64, z: 0 } } }, pathfinder: { setGoal: jest.fn(), setMovements: jest.fn(), stop: jest.fn(), isMoving: () => true } },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    const r = await gotoEntityTool.execute({ entityId: 42 }, ctx);
    expect(agentActionExecutor.run).toHaveBeenCalledTimes(1);
    const [actionArg] = agentActionExecutor.run.mock.calls[0];
    expect(actionArg.name).toBe('goto_entity');
    expect(r.ok).toBe(true);
  });

  it('rejects non-numeric entityId', async () => {
    const ctx: any = { bot: {}, signal: new AbortController().signal, targetExecutor: {}, agentActionExecutor: { run: jest.fn() }, safeChat: () => {} };
    const r = await gotoEntityTool.execute({ entityId: 'x' } as any, ctx);
    expect(r.ok).toBe(false);
  });

  it('flags missing immediately if the entity does not exist on start', async () => {
    let captured: any = null;
    const agentActionExecutor = {
      run: jest.fn().mockImplementation(async (action: any) => {
        captured = action;
        action.start(ctx.bot);
        return { ok: false, error: 'entity lost' };
      })
    };
    const setGoal = jest.fn();
    const ctx: any = {
      bot: { entity: { position: { x: 0, y: 64, z: 0 } }, entities: {}, pathfinder: { setMovements: jest.fn(), setGoal, stop: jest.fn(), isMoving: () => false } },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    await gotoEntityTool.execute({ entityId: 99 }, ctx);
    expect(setGoal).not.toHaveBeenCalled();
    expect(captured.isFinished()).toBe(true);
    expect(captured.result()).toEqual({ ok: false, error: 'entity lost' });
  });

  it('isFinished true when within followDistance and not moving', async () => {
    let captured: any = null;
    const agentActionExecutor = {
      run: jest.fn().mockImplementation(async (action: any) => { captured = action; return { ok: true }; })
    };
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        entities: { 7: { position: { x: 1.5, y: 64, z: 0 } } },
        pathfinder: { setMovements: jest.fn(), setGoal: jest.fn(), stop: jest.fn(), isMoving: () => false }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    await gotoEntityTool.execute({ entityId: 7, followDistance: 2 }, ctx);
    expect(captured.isFinished()).toBe(true);
    const r = captured.result();
    expect(r.ok).toBe(true);
  });

  it('isFinished remains false while still far away', async () => {
    let captured: any = null;
    const agentActionExecutor = {
      run: jest.fn().mockImplementation(async (action: any) => { captured = action; return { ok: true }; })
    };
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        entities: { 7: { position: { x: 100, y: 64, z: 0 } } },
        pathfinder: { setMovements: jest.fn(), setGoal: jest.fn(), stop: jest.fn(), isMoving: () => true }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    await gotoEntityTool.execute({ entityId: 7, followDistance: 2, timeout: 60 }, ctx);
    expect(captured.isFinished()).toBe(false);
  });
});
