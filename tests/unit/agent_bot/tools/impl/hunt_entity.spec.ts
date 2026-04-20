const mockCreateHuntEntityState = jest.fn();
const mockCreateTrackedBotStateMachine = jest.fn();

jest.mock('../../../../../behaviors/behaviorHuntEntity', () => ({
  __esModule: true,
  default: (...args: any[]) => mockCreateHuntEntityState(...args)
}));
jest.mock('../../../../../bots/collector/state_machine_utils', () => ({
  createTrackedBotStateMachine: (...args: any[]) => mockCreateTrackedBotStateMachine(...args)
}));

import { huntEntityTool } from '../../../../../bots/agent_bot/tools/impl/hunt_entity';

function makeStateMachine() {
  return {
    active: false,
    isFinished: jest.fn().mockReturnValue(false),
    onStateEntered: jest.fn(),
    onStateExited: jest.fn()
  };
}

function makeBot(entities: Record<number, any>) {
  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    entities,
    pvp: { target: null, attack: jest.fn(), stop: jest.fn() },
    pathfinder: { stop: jest.fn(), setGoal: jest.fn() },
    on: jest.fn(),
    removeListener: jest.fn()
  };
}

describe('hunt_entity tool', () => {
  let sm: ReturnType<typeof makeStateMachine>;
  let tickListener: (...args: any[]) => void;

  beforeEach(() => {
    sm = makeStateMachine();
    tickListener = jest.fn();
    mockCreateHuntEntityState.mockReturnValue(sm);
    mockCreateTrackedBotStateMachine.mockReturnValue({ listener: tickListener });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-numeric entityId', async () => {
    const ctx: any = {
      bot: makeBot({}),
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: { run: jest.fn() },
      safeChat: () => {}
    };
    const r = await huntEntityTool.execute({ entityId: 'bad' } as any, ctx);
    expect(r.ok).toBe(false);
  });

  it('returns entity not found when id does not resolve', async () => {
    const ctx: any = {
      bot: makeBot({}),
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: { run: jest.fn() },
      safeChat: () => {}
    };
    const r = await huntEntityTool.execute({ entityId: 42 }, ctx);
    expect(r).toEqual({ ok: false, error: 'entity not found' });
    expect(ctx.agentActionExecutor.run).not.toHaveBeenCalled();
  });

  it('delegates to agentActionExecutor.run with a named hunt_entity action', async () => {
    const ctx: any = {
      bot: makeBot({ 42: { id: 42, position: { x: 1, y: 64, z: 0 }, isValid: true } }),
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockResolvedValue({ ok: true, data: { killed: true, entityId: 42 } })
      },
      safeChat: () => {}
    };
    const r = await huntEntityTool.execute({ entityId: 42 }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.agentActionExecutor.run).toHaveBeenCalledTimes(1);
    expect(ctx.agentActionExecutor.run.mock.calls[0][0].name).toBe('hunt_entity');
  });

  it('start attaches physicsTick listener and enters the state machine', async () => {
    let captured: any = null;
    const bot = makeBot({ 7: { id: 7, position: { x: 2, y: 64, z: 0 }, isValid: true } });
    const ctx: any = {
      bot,
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    expect(mockCreateHuntEntityState).toHaveBeenCalledTimes(1);
    expect(mockCreateTrackedBotStateMachine).toHaveBeenCalledWith(bot, sm);
    expect(bot.on).toHaveBeenCalledWith('physicsTick', tickListener);
    expect(bot.on).toHaveBeenCalledWith('physicTick', tickListener);
    expect(sm.active).toBe(true);
    expect(sm.onStateEntered).toHaveBeenCalled();
    expect(captured.name).toBe('hunt_entity');
  });

  it('isFinished returns true when entity.isValid becomes false and result flags killed', async () => {
    let captured: any = null;
    const entities: any = { 7: { id: 7, position: { x: 2, y: 64, z: 0 }, isValid: true } };
    const bot = makeBot(entities);
    const ctx: any = {
      bot,
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    entities[7].isValid = false;
    expect(captured.isFinished()).toBe(true);
    expect(captured.result()).toEqual({ ok: true, data: { killed: true, entityId: 7 } });
  });

  it('isFinished returns true when entity despawns (removed from bot.entities) and flags killed', async () => {
    let captured: any = null;
    const entities: any = { 7: { id: 7, position: { x: 2, y: 64, z: 0 }, isValid: true } };
    const bot = makeBot(entities);
    const ctx: any = {
      bot,
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    delete entities[7];
    expect(captured.isFinished()).toBe(true);
    expect(captured.result()).toEqual({ ok: true, data: { killed: true, entityId: 7 } });
  });

  it('isFinished returns true when the wrapped state machine is finished', async () => {
    let captured: any = null;
    const bot = makeBot({ 7: { id: 7, position: { x: 2, y: 64, z: 0 }, isValid: true } });
    const ctx: any = {
      bot,
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    expect(captured.isFinished()).toBe(false);
    sm.isFinished.mockReturnValue(true);
    expect(captured.isFinished()).toBe(true);
  });

  it('isFinished + result honour the timeout deadline', async () => {
    let captured: any = null;
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const bot = makeBot({ 7: { id: 7, position: { x: 2, y: 64, z: 0 }, isValid: true } });
      const ctx: any = {
        bot,
        signal: new AbortController().signal,
        targetExecutor: {},
        agentActionExecutor: {
          run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(bot); return { ok: false }; })
        },
        safeChat: () => {}
      };
      await huntEntityTool.execute({ entityId: 7, timeout: 2 }, ctx);
      expect(captured.isFinished()).toBe(false);
      now += 2500;
      expect(captured.isFinished()).toBe(true);
      expect(captured.result()).toEqual({ ok: false, error: 'timeout' });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('stop removes listeners, deactivates state machine, and stops pvp + pathfinder', async () => {
    let captured: any = null;
    const bot = makeBot({ 7: { id: 7, position: { x: 2, y: 64, z: 0 }, isValid: true } });
    const ctx: any = {
      bot,
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    captured.stop();
    expect(bot.removeListener).toHaveBeenCalledWith('physicsTick', tickListener);
    expect(bot.removeListener).toHaveBeenCalledWith('physicTick', tickListener);
    expect(sm.active).toBe(false);
    expect(sm.onStateExited).toHaveBeenCalled();
    expect(bot.pvp.stop).toHaveBeenCalled();
    expect(bot.pathfinder.stop).toHaveBeenCalled();
  });

  it('stop is idempotent', async () => {
    let captured: any = null;
    const bot = makeBot({ 7: { id: 7, position: { x: 2, y: 64, z: 0 }, isValid: true } });
    const ctx: any = {
      bot,
      signal: new AbortController().signal,
      targetExecutor: {},
      agentActionExecutor: {
        run: jest.fn().mockImplementation(async (action: any) => { captured = action; action.start(bot); return { ok: true }; })
      },
      safeChat: () => {}
    };
    await huntEntityTool.execute({ entityId: 7 }, ctx);
    captured.stop();
    captured.stop();
    expect(bot.pvp.stop).toHaveBeenCalledTimes(1);
    expect(sm.onStateExited).toHaveBeenCalledTimes(1);
  });
});
