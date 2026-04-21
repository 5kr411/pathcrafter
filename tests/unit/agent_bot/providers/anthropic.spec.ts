import { AnthropicProvider } from '../../../../bots/agent_bot/providers/anthropic';
import type { ToolSchema } from '../../../../bots/agent_bot/providers/types';

describe('AnthropicProvider', () => {
  const tool: ToolSchema = {
    name: 'get_position',
    description: 'Get bot position',
    inputSchema: { type: 'object', properties: {}, required: [] }
  };

  it('translates tools and parses tool_use response', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg_1',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'tu_1', name: 'get_position', input: {} }
        ],
        usage: { input_tokens: 42, output_tokens: 7 }
      })
    });
    const provider = new AnthropicProvider(
      { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test' },
      fakeFetch as any
    );
    const result = await provider.runTurn({
      system: 'you are a bot',
      messages: [{ role: 'user', content: 'where are you?' }],
      tools: [tool],
      signal: new AbortController().signal
    });
    expect(result.stopReason).toBe('tool_use');
    expect(result.text).toBe('let me check');
    expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'get_position', input: {} }]);
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });

    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.system).toBe('you are a bot');
    expect(body.tools).toEqual([
      { name: 'get_position', description: 'Get bot position', input_schema: tool.inputSchema }
    ]);
  });

  it('parses end_turn with only text', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 5, output_tokens: 2 }
      })
    });
    const provider = new AnthropicProvider(
      { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k' },
      fakeFetch as any
    );
    const result = await provider.runTurn({
      system: '', messages: [{ role: 'user', content: 'hi' }],
      tools: [], signal: new AbortController().signal
    });
    expect(result.stopReason).toBe('end');
    expect(result.text).toBe('done');
    expect(result.toolCalls).toEqual([]);
  });

  it('surfaces HTTP errors as stopReason:error', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'internal'
    });
    const provider = new AnthropicProvider(
      { provider: 'anthropic', model: 'm', apiKey: 'k' },
      fakeFetch as any
    );
    const r = await provider.runTurn({
      system: '', messages: [{ role: 'user', content: 'x' }], tools: [],
      signal: new AbortController().signal
    });
    expect(r.stopReason).toBe('error');
  });

  it('honors AbortSignal', async () => {
    const fakeFetch = jest.fn((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })
    );
    const ctrl = new AbortController();
    const provider = new AnthropicProvider(
      { provider: 'anthropic', model: 'm', apiKey: 'k' },
      fakeFetch as any
    );
    const p = provider.runTurn({ system: '', messages: [{ role: 'user', content: 'x' }], tools: [], signal: ctrl.signal });
    ctrl.abort();
    const r = await p;
    expect(r.stopReason).toBe('cancelled');
  });

  it('returns error with timeout detail when fetch wedges past 60s', async () => {
    jest.useFakeTimers();
    const hangingFetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    );
    const provider = new AnthropicProvider(
      { provider: 'anthropic', model: 'm', apiKey: 'k' },
      hangingFetch as any
    );
    const parent = new AbortController();
    const promise = provider.runTurn({
      system: '', messages: [{ role: 'user', content: 'x' }],
      tools: [], signal: parent.signal
    });
    jest.advanceTimersByTime(60_001);
    const r = await promise;
    expect(r.stopReason).toBe('error');
    expect(r.errorDetail).toMatch(/timeout/i);
    expect(parent.signal.aborted).toBe(false);
    jest.useRealTimers();
  });
});
