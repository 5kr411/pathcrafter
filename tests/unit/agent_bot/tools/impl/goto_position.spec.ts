import { gotoPositionTool } from '../../../../../bots/agent_bot/tools/impl/goto_position';

describe('goto_position tool', () => {
  it('delegates to agentActionExecutor.run and returns its result', async () => {
    const agentActionExecutor = {
      run: jest.fn().mockResolvedValue({ ok: true, data: { arrivedAt: { x: 10, y: 64, z: 5 } } })
    };
    const ctx: any = {
      bot: { entity: { position: { x: 0, y: 64, z: 0 } }, pathfinder: { setGoal: jest.fn(), setMovements: jest.fn(), stop: jest.fn(), isMoving: () => false } },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    const r = await gotoPositionTool.execute({ x: 10, y: 64, z: 5 }, ctx);
    expect(agentActionExecutor.run).toHaveBeenCalledTimes(1);
    const [actionArg, signalArg] = agentActionExecutor.run.mock.calls[0];
    expect(actionArg.name).toBe('goto_position');
    expect(signalArg).toBe(ctx.signal);
    expect(r).toEqual({ ok: true, data: { arrivedAt: { x: 10, y: 64, z: 5 } } });
  });

  it('action.start delegates to pathfinder.setGoal', async () => {
    let captured: any = null;
    const agentActionExecutor = {
      run: jest.fn().mockImplementation(async (action: any) => {
        captured = action;
        action.start(ctx.bot);
        return { ok: true };
      })
    };
    const setGoal = jest.fn();
    // Note: `new Movements(bot)` throws on a stub bot without a registry;
    // the tool swallows that error but setGoal should still run.
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        pathfinder: { setMovements: jest.fn(), setGoal, stop: jest.fn(), isMoving: () => false }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    await gotoPositionTool.execute({ x: 10, y: 64, z: 5 }, ctx);
    expect(setGoal).toHaveBeenCalled();
    expect(captured).toBeTruthy();
    expect(captured.name).toBe('goto_position');
  });

  it('action.isFinished returns true when within 2 blocks and not moving', async () => {
    let captured: any = null;
    const agentActionExecutor = {
      run: jest.fn().mockImplementation(async (action: any) => { captured = action; return { ok: true }; })
    };
    const ctx: any = {
      bot: {
        entity: { position: { x: 10.5, y: 64, z: 4.5 } },
        pathfinder: { setMovements: jest.fn(), setGoal: jest.fn(), stop: jest.fn(), isMoving: () => false }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    await gotoPositionTool.execute({ x: 10, y: 64, z: 5 }, ctx);
    expect(captured.isFinished()).toBe(true);
    expect(captured.result()).toEqual({ ok: true, data: { arrivedAt: { x: 10.5, y: 64, z: 4.5 } } });
  });

  it('action.isFinished returns false when far from target', async () => {
    let captured: any = null;
    const agentActionExecutor = {
      run: jest.fn().mockImplementation(async (action: any) => { captured = action; return { ok: true }; })
    };
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        pathfinder: { setMovements: jest.fn(), setGoal: jest.fn(), stop: jest.fn(), isMoving: () => true }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    await gotoPositionTool.execute({ x: 100, y: 64, z: 100, timeout: 60 }, ctx);
    expect(captured.isFinished()).toBe(false);
  });

  it('rejects non-numeric coords', async () => {
    const ctx: any = {
      bot: {}, signal: new AbortController().signal,
      targetExecutor: {}, agentActionExecutor: { run: jest.fn() }, safeChat: () => {}
    };
    const r = await gotoPositionTool.execute({ x: 'a', y: 1, z: 1 } as any, ctx);
    expect(r.ok).toBe(false);
  });
});
