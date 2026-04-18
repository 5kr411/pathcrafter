import { huntEntityTool } from '../../../../../bots/agent_bot/tools/impl/hunt_entity';

describe('hunt_entity tool', () => {
  it('delegates to agentActionExecutor.run', async () => {
    const agentActionExecutor = {
      run: jest.fn().mockResolvedValue({ ok: true, data: { killed: true, entityId: 42 } })
    };
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        entities: { 42: { position: { x: 1, y: 64, z: 0 }, isValid: true } },
        pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
        pathfinder: { stop: jest.fn() }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor,
      safeChat: () => {}
    };
    const r = await huntEntityTool.execute({ entityId: 42 }, ctx);
    expect(r.ok).toBe(true);
    expect(agentActionExecutor.run).toHaveBeenCalledTimes(1);
    expect(agentActionExecutor.run.mock.calls[0][0].name).toBe('hunt_entity');
  });

  it('rejects non-numeric entityId', async () => {
    const ctx: any = { bot: {}, signal: new AbortController().signal, targetExecutor: {}, agentActionExecutor: { run: jest.fn() }, safeChat: () => {} };
    const r = await huntEntityTool.execute({ entityId: 'bad' } as any, ctx);
    expect(r.ok).toBe(false);
  });

  it('start invokes bot.pvp.attack on the resolved entity', async () => {
    let captured: any = null;
    const attack = jest.fn();
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        entities: { 7: { position: { x: 2, y: 64, z: 0 }, isValid: true } },
        pvp: { target: null, attack, stop: jest.fn() },
        pathfinder: { stop: jest.fn() }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(ctx.bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    expect(attack).toHaveBeenCalledWith(ctx.bot.entities[7]);
    expect(captured).toBeTruthy();
  });

  it('isFinished + result returns lost when entity disappears and stays gone past grace', async () => {
    let captured: any = null;
    const entities: any = { 7: { position: { x: 2, y: 64, z: 0 }, isValid: true } };
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const ctx: any = {
        bot: {
          entity: { position: { x: 0, y: 64, z: 0 } },
          entities,
          pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
          pathfinder: { stop: jest.fn() }
        },
        signal: new AbortController().signal,
        targetExecutor: {},
        agentActionExecutor: {
          run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(ctx.bot); return { ok: true }; })
        },
        safeChat: () => {}
      };
      await huntEntityTool.execute({ entityId: 7 }, ctx);
      // Entity disappears
      delete entities[7];
      captured.update();
      // Still within grace window.
      expect(captured.isFinished()).toBe(false);
      now += 3000;
      captured.update();
      expect(captured.isFinished()).toBe(true);
      expect(captured.result()).toEqual({ ok: false, error: 'lost' });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('returns lost when entity never existed', async () => {
    let captured: any = null;
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        entities: {},
        pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
        pathfinder: { stop: jest.fn() }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(ctx.bot); return { ok: false, error: 'lost' }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 99 }, ctx);
    expect(captured.isFinished()).toBe(true);
    const r = captured.result();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('lost');
  });

  it('tolerates transient disappearance within grace window', async () => {
    jest.useFakeTimers();
    try {
      let captured: any = null;
      const entities: any = { 7: { position: { x: 2, y: 64, z: 0 }, isValid: true } };
      const ctx: any = {
        bot: {
          entity: { position: { x: 0, y: 64, z: 0 } },
          entities,
          pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
          pathfinder: { stop: jest.fn() }
        },
        signal: new AbortController().signal,
        targetExecutor: {},
        agentActionExecutor: {
          run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(ctx.bot); return { ok: true }; })
        },
        safeChat: () => {}
      };
      await huntEntityTool.execute({ entityId: 7 }, ctx);
      // Entity briefly disappears.
      delete entities[7];
      captured.update();
      // Grace period has not expired → not finished yet.
      expect(captured.isFinished()).toBe(false);
      // Entity reappears before grace expires.
      entities[7] = { position: { x: 2, y: 64, z: 0 }, isValid: true };
      captured.update();
      expect(captured.isFinished()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('flags lost after entity is missing past grace window', async () => {
    let captured: any = null;
    const entities: any = { 7: { position: { x: 2, y: 64, z: 0 }, isValid: true } };
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const ctx: any = {
        bot: {
          entity: { position: { x: 0, y: 64, z: 0 } },
          entities,
          pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
          pathfinder: { stop: jest.fn() }
        },
        signal: new AbortController().signal,
        targetExecutor: {},
        agentActionExecutor: {
          run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(ctx.bot); return { ok: true }; })
        },
        safeChat: () => {}
      };
      await huntEntityTool.execute({ entityId: 7 }, ctx);
      // Entity disappears.
      delete entities[7];
      captured.update();
      // Within grace → not finished.
      expect(captured.isFinished()).toBe(false);
      // Advance beyond grace window.
      now += 3000;
      captured.update();
      expect(captured.isFinished()).toBe(true);
      const r = captured.result();
      expect(r.ok).toBe(false);
      expect(r.error).toBe('lost');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('flags lost if entity never resolved and grace passes', async () => {
    let captured: any = null;
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const ctx: any = {
        bot: {
          entity: { position: { x: 0, y: 64, z: 0 } },
          entities: {},
          pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
          pathfinder: { stop: jest.fn() }
        },
        signal: new AbortController().signal,
        targetExecutor: {},
        agentActionExecutor: {
          run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(ctx.bot); return { ok: false, error: 'lost' }; })
        },
        safeChat: () => {}
      };
      await huntEntityTool.execute({ entityId: 99 }, ctx);
      expect(captured.isFinished()).toBe(true);
      const r = captured.result();
      expect(r.ok).toBe(false);
      expect(r.error).toBe('lost');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('flags killed immediately when entity.isValid becomes false', async () => {
    let captured: any = null;
    const entities: any = { 7: { position: { x: 2, y: 64, z: 0 }, isValid: true } };
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        entities,
        pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
        pathfinder: { stop: jest.fn() }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(ctx.bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    entities[7].isValid = false;
    expect(captured.isFinished()).toBe(true);
    expect(captured.result()).toEqual({ ok: true, data: { killed: true, entityId: 7 } });
  });

  it('stop calls pvp.stop and pathfinder.stop', async () => {
    let captured: any = null;
    const pvpStop = jest.fn();
    const pathStop = jest.fn();
    const ctx: any = {
      bot: {
        entity: { position: { x: 0, y: 64, z: 0 } },
        entities: { 7: { position: { x: 2, y: 64, z: 0 }, isValid: true } },
        pvp: { target: null, attack: jest.fn(), stop: pvpStop },
        pathfinder: { stop: pathStop }
      },
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    captured.stop();
    expect(pvpStop).toHaveBeenCalled();
    expect(pathStop).toHaveBeenCalled();
  });
});
