import { OpenAIProvider } from '../../../../bots/agent_bot/providers/openai';
import type { ToolSchema } from '../../../../bots/agent_bot/providers/types';

describe('OpenAIProvider', () => {
  const tool: ToolSchema = {
    name: 'get_position',
    description: 'Get bot position',
    inputSchema: { type: 'object', properties: {}, required: [] }
  };

  it('translates tools and parses tool_calls response', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'chatcmpl_1',
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: 'let me check',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'get_position', arguments: '{}' }
            }]
          }
        }],
        usage: { prompt_tokens: 42, completion_tokens: 7 }
      })
    });
    const provider = new OpenAIProvider(
      { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
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
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'get_position', input: {} }]);
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });

    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'get_position', description: 'Get bot position', parameters: tool.inputSchema } }
    ]);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'you are a bot' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'where are you?' });
  });

  it('parses stop finish_reason with only text', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }],
        usage: { prompt_tokens: 5, completion_tokens: 2 }
      })
    });
    const provider = new OpenAIProvider(
      { provider: 'openai', model: 'gpt-4o', apiKey: 'k' },
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
    const provider = new OpenAIProvider(
      { provider: 'openai', model: 'm', apiKey: 'k' },
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
    const provider = new OpenAIProvider(
      { provider: 'openai', model: 'm', apiKey: 'k' },
      fakeFetch as any
    );
    const p = provider.runTurn({ system: '', messages: [{ role: 'user', content: 'x' }], tools: [], signal: ctrl.signal });
    ctrl.abort();
    const r = await p;
    expect(r.stopReason).toBe('cancelled');
  });
});
