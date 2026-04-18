import { AgentSession } from '../../../bots/agent_bot/agent_session';
import type { LLMProvider, TurnResult, TurnParams } from '../../../bots/agent_bot/providers/types';
import type { ToolExecutor } from '../../../bots/agent_bot/tools/executor';

function makeFakeProvider(responses: TurnResult[]): LLMProvider & { calls: TurnParams[] } {
  const provider: any = {
    calls: [] as TurnParams[],
    label: () => 'fake',
    async runTurn(params: TurnParams): Promise<TurnResult> {
      provider.calls.push(params);
      const next = responses.shift();
      if (!next) throw new Error('FakeProvider: no more staged responses');
      return next;
    }
  };
  return provider;
}

function makeToolExecutor(runImpl?: (call: any, ctx: any) => Promise<any>): ToolExecutor {
  return {
    schemas: () => [],
    run: runImpl ?? (async () => ({ ok: true, data: 'ok' }))
  } as unknown as ToolExecutor;
}

function baseDeps(overrides: Partial<ConstructorParameters<typeof AgentSession>[0]> = {}) {
  const safeChat = jest.fn();
  return {
    deps: {
      bot: {},
      provider: makeFakeProvider([]),
      toolExecutor: makeToolExecutor(),
      targetExecutor: {},
      agentActionExecutor: {},
      safeChat,
      idleMs: 50,
      maxToolsPerSession: 30,
      ...overrides
    },
    safeChat
  };
}

describe('AgentSession', () => {
  it('terminates loop on stopReason: end and calls safeChat', async () => {
    const provider = makeFakeProvider([
      { text: 'done', toolCalls: [], stopReason: 'end' }
    ]);
    const { deps, safeChat } = baseDeps({ provider });
    const session = new AgentSession(deps);
    await session.submitUserMessage('hi', { speaker: 'alice' });
    // Allow the run() loop microtasks to finish.
    await Promise.resolve();
    await Promise.resolve();
    expect(safeChat).toHaveBeenCalledWith('done');
    expect(session.isActive()).toBe(true); // idle counts as active
  });

  it('continues loop on stopReason: tool_use and appends tool_result', async () => {
    const provider = makeFakeProvider([
      { text: null, toolCalls: [{ id: 't1', name: 'fake_tool', input: {} }], stopReason: 'tool_use' },
      { text: 'finished', toolCalls: [], stopReason: 'end' }
    ]);
    const runMock = jest.fn(async () => ({ ok: true, data: 'yay' }));
    const toolExecutor = makeToolExecutor(runMock);
    const { deps, safeChat } = baseDeps({ provider, toolExecutor });
    const session = new AgentSession(deps);
    await session.submitUserMessage('get a thing', { speaker: 'alice' });
    // Let both turns flush.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(provider.calls.length).toBe(2);
    expect(safeChat).toHaveBeenCalledWith('finished');
    const messages = (session as any).messages as any[];
    const hasToolResult = messages.some(m =>
      m.role === 'tool' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result')
    );
    expect(hasToolResult).toBe(true);
  });

  it('mid-turn new user message fires abort on the in-flight tool', async () => {
    // Hanging tool: resolves only when signal aborts.
    let abortedFlag = false;
    const hangingTool = (_call: any, ctx: any) =>
      new Promise<any>((resolve) => {
        ctx.signal.addEventListener('abort', () => {
          abortedFlag = true;
          resolve({ ok: false, error: 'cancelled', cancelled: true });
        });
      });

    const provider = makeFakeProvider([
      // First goal triggers a tool that hangs.
      { text: null, toolCalls: [{ id: 't1', name: 'hang', input: {} }], stopReason: 'tool_use' },
      // After abort -> re-entry, the provider sees the new user message and ends.
      { text: 'second goal done', toolCalls: [], stopReason: 'end' }
    ]);
    const toolExecutor = makeToolExecutor(hangingTool);
    const { deps, safeChat } = baseDeps({ provider, toolExecutor });
    const session = new AgentSession(deps);

    await session.submitUserMessage('first goal', { speaker: 'alice' });
    // Let the first runTurn fire & tool dispatch begin.
    for (let i = 0; i < 3; i++) await Promise.resolve();
    expect(provider.calls.length).toBe(1);

    // Submit a second message while the tool hangs — should abort + re-enter loop.
    await session.submitUserMessage('second goal', { speaker: 'alice' });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(abortedFlag).toBe(true);
    const messages = (session as any).messages as any[];
    // Both user messages recorded.
    const userMsgs = messages.filter(m => m.role === 'user');
    expect(userMsgs.length).toBe(2);
    expect(safeChat).toHaveBeenCalledWith('second goal done');
  });

  it('idle timer destroys session after idleMs', async () => {
    jest.useFakeTimers();
    try {
      const provider = makeFakeProvider([
        { text: 'done', toolCalls: [], stopReason: 'end' }
      ]);
      const { deps } = baseDeps({ provider, idleMs: 50 });
      const session = new AgentSession(deps);
      await session.submitUserMessage('hi', { speaker: 'alice' });
      // Let run() finish and arm the idle timer.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(session.isActive()).toBe(true);
      jest.advanceTimersByTime(100);
      expect(session.isActive()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('destroy() clears state and prevents further turns', async () => {
    const provider = makeFakeProvider([
      { text: 'done', toolCalls: [], stopReason: 'end' }
    ]);
    const { deps } = baseDeps({ provider });
    const session = new AgentSession(deps);
    await session.submitUserMessage('hi', { speaker: 'alice' });
    session.destroy();
    expect((session as any).state).toBe('dead');
    expect((session as any).messages).toEqual([]);
    expect(session.isActive()).toBe(false);
  });
});
