import { AgentActionExecutor, type AgentAction } from '../../../bots/agent_bot/action_executor';
import type { ToolResult } from '../../../bots/agent_bot/tools/types';

describe('AgentActionExecutor', () => {
  it('starts with no work and idle state', () => {
    const exec = new AgentActionExecutor({} as any);
    expect(exec.hasWork()).toBe(false);
    expect(exec.active).toBe(false);
  });

  it('runs an action and resolves its promise on completion', async () => {
    const exec = new AgentActionExecutor({} as any);
    const stopSpy = jest.fn();
    const action: AgentAction = {
      name: 'mock',
      start: () => {},
      update: () => {},
      stop: stopSpy,
      isFinished: () => !!(action as any)._done,
      result: () => ({ ok: true, data: 'done' })
    };
    const p = exec.run(action, new AbortController().signal);
    exec.onStateEntered();
    expect(exec.hasWork()).toBe(true);
    expect(exec.active).toBe(true);
    // Tick 1: not done yet
    exec.update();
    expect(stopSpy).not.toHaveBeenCalled();
    (action as any)._done = true;
    // Tick 2: now done → resolves AND calls stop() so side effects
    // (pathfinder goals, pvp targets) don't leak past completion.
    exec.update();
    const r = await p;
    expect(r).toEqual({ ok: true, data: 'done' });
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(exec.hasWork()).toBe(false);
  });

  it('cancels via AbortSignal', async () => {
    const exec = new AgentActionExecutor({} as any);
    const stopSpy = jest.fn();
    const action: AgentAction = {
      name: 'mock',
      start: () => {},
      update: () => {},
      stop: stopSpy,
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const ctrl = new AbortController();
    const p = exec.run(action, ctrl.signal);
    exec.onStateEntered();
    ctrl.abort();
    exec.update();
    const r = (await p) as ToolResult;
    expect(stopSpy).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect((r as { cancelled?: boolean }).cancelled).toBe(true);
    expect(exec.hasWork()).toBe(false);
  });

  it('preempts on onStateExited with unfinished action', async () => {
    const exec = new AgentActionExecutor({} as any);
    const stopSpy = jest.fn();
    const action: AgentAction = {
      name: 'mock',
      start: () => {},
      update: () => {},
      stop: stopSpy,
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const p = exec.run(action, new AbortController().signal);
    exec.onStateEntered();
    exec.onStateExited();
    const r = (await p) as ToolResult;
    expect(stopSpy).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect((r as { preempted?: boolean }).preempted).toBe(true);
    expect(exec.active).toBe(false);
    expect(exec.hasWork()).toBe(false);
  });

  it('external stop() resolves in-flight action with cancelled', async () => {
    const exec = new AgentActionExecutor({} as any);
    const stopSpy = jest.fn();
    const action: AgentAction = {
      name: 'mock',
      start: () => {},
      update: () => {},
      stop: stopSpy,
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const p = exec.run(action, new AbortController().signal);
    exec.onStateEntered();
    exec.stop();
    const r = (await p) as ToolResult;
    expect(stopSpy).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect((r as { cancelled?: boolean }).cancelled).toBe(true);
  });

  it('throws if a second action is started while one is in flight', () => {
    const exec = new AgentActionExecutor({} as any);
    const action: AgentAction = {
      name: 'a',
      start: () => {},
      update: () => {},
      stop: () => {},
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    exec.run(action, new AbortController().signal);
    expect(() => exec.run(action, new AbortController().signal)).toThrow(/already running/);
  });

  it('surfaces repeated update() throws after 10 consecutive failures', async () => {
    const exec = new AgentActionExecutor({} as any);
    const action: AgentAction = {
      name: 'throwy',
      start: () => {},
      update: () => { throw new Error('boom'); },
      stop: () => {},
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const p = exec.run(action, new AbortController().signal);
    exec.onStateEntered();
    for (let i = 0; i < 11; i++) exec.update();
    const r = (await p) as ToolResult;
    expect(r.ok).toBe(false);
    expect((r as { error?: string }).error).toMatch(/update failed/i);
    expect(exec.hasWork()).toBe(false);
  });

  it('returns immediate cancelled if signal already aborted', async () => {
    const exec = new AgentActionExecutor({} as any);
    const ctrl = new AbortController();
    ctrl.abort();
    const action: AgentAction = {
      name: 'mock',
      start: () => {},
      update: () => {},
      stop: () => {},
      isFinished: () => false,
      result: () => ({ ok: true })
    };
    const r = (await exec.run(action, ctrl.signal)) as ToolResult;
    expect(r.ok).toBe(false);
    expect((r as { cancelled?: boolean }).cancelled).toBe(true);
    expect(exec.hasWork()).toBe(false);
  });
});
