import { sendChatTool } from '../../../../../bots/agent_bot/tools/impl/send_chat';

describe('send_chat', () => {
  it('prefers ctx.safeChat when provided', async () => {
    const calls: string[] = [];
    const bot: any = { chat: (m: string) => calls.push(`chat:${m}`) };
    const ctx: any = {
      bot, signal: new AbortController().signal,
      targetExecutor: {}, agentActionExecutor: {},
      safeChat: (m: string) => calls.push(`safe:${m}`)
    };
    const r = await sendChatTool.execute({ message: 'hello' }, ctx);
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual(['safe:hello']);
  });

  it('falls back to bot.chat when no safeChat', async () => {
    const calls: string[] = [];
    const bot: any = { chat: (m: string) => calls.push(m) };
    const ctx: any = {
      bot, signal: new AbortController().signal,
      targetExecutor: {}, agentActionExecutor: {},
      safeChat: undefined as any
    };
    const r = await sendChatTool.execute({ message: 'yo' }, ctx);
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual(['yo']);
  });

  it('errors if no message string', async () => {
    const ctx: any = {
      bot: { chat: () => {} }, signal: new AbortController().signal,
      targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
    };
    const r = await sendChatTool.execute({}, ctx);
    expect(r.ok).toBe(false);
  });
});
