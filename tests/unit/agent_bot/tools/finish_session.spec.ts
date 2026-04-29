import { finishSessionTool } from '../../../../bots/agent_bot/tools/impl/finish_session';

function ctxStub(overrides: Partial<any> = {}): any {
  return {
    bot: {},
    signal: new AbortController().signal,
    targetExecutor: {} as any,
    agentActionExecutor: {} as any,
    safeChat: jest.fn(),
    onFinishSession: jest.fn(),
    ...overrides
  };
}

describe('finish_session tool', () => {
  it('schema declares a required reason string', () => {
    expect(finishSessionTool.schema.name).toBe('finish_session');
    expect((finishSessionTool.schema.inputSchema as any).required).toEqual(['reason']);
  });

  it('rejects empty / non-string reason', async () => {
    const ctx = ctxStub();
    const out1 = await finishSessionTool.execute({ reason: '' } as any, ctx);
    expect(out1.ok).toBe(false);
    const out2 = await finishSessionTool.execute({} as any, ctx);
    expect(out2.ok).toBe(false);
  });

  it('emits chat, fires callback, and returns ok', async () => {
    const ctx = ctxStub();
    const result = await finishSessionTool.execute({ reason: 'all goals met' }, ctx);
    expect(result.ok).toBe(true);
    expect(ctx.safeChat).toHaveBeenCalledWith('[done] all goals met');
    expect(ctx.onFinishSession).toHaveBeenCalledWith('all goals met');
  });

  it('result data hints the model to stop emitting tool calls', async () => {
    const ctx = ctxStub();
    const result: any = await finishSessionTool.execute({ reason: 'finished' }, ctx);
    expect(result.data?.acknowledged).toBe(true);
  });
});
