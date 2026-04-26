import { GeminiProvider } from '../../../../bots/agent_bot/providers/gemini';
import type { ToolSchema } from '../../../../bots/agent_bot/providers/types';

describe('GeminiProvider', () => {
  const tool: ToolSchema = {
    name: 'get_position',
    description: 'Get bot position',
    inputSchema: { type: 'object', properties: {}, required: [] }
  };

  it('translates tools and parses functionCall response', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            role: 'model',
            parts: [
              { text: 'let me check' },
              { functionCall: { name: 'get_position', args: {} } }
            ]
          },
          finishReason: 'STOP'
        }],
        usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7 }
      })
    });
    const provider = new GeminiProvider(
      { provider: 'gemini', model: 'gemini-1.5-pro', apiKey: 'sk-test' },
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
    expect(result.toolCalls).toEqual([{ id: 'call_0', name: 'get_position', input: {} }]);
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });

    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent');
    expect(url).not.toMatch(/[?&]key=/);
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('sk-test');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'you are a bot' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'where are you?' }] }]);
    expect(body.tools).toEqual([
      { functionDeclarations: [{ name: 'get_position', description: 'Get bot position', parameters: tool.inputSchema }] }
    ]);
  });

  it('parses STOP finishReason with only text as end', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { role: 'model', parts: [{ text: 'done' }] },
          finishReason: 'STOP'
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 }
      })
    });
    const provider = new GeminiProvider(
      { provider: 'gemini', model: 'gemini-1.5-pro', apiKey: 'k' },
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
    const provider = new GeminiProvider(
      { provider: 'gemini', model: 'm', apiKey: 'k' },
      fakeFetch as any
    );
    const r = await provider.runTurn({
      system: '', messages: [{ role: 'user', content: 'x' }], tools: [],
      signal: new AbortController().signal
    });
    expect(r.stopReason).toBe('error');
  });

  it('propagates tool_result name into functionResponse.name (multi-turn)', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { role: 'model', parts: [{ text: 'ok' }] },
          finishReason: 'STOP'
        }]
      })
    });
    const provider = new GeminiProvider(
      { provider: 'gemini', model: 'gemini-1.5-pro', apiKey: 'sk' },
      fakeFetch as any
    );
    await provider.runTurn({
      system: '',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_0', name: 'get_position', input: {} }] },
        {
          role: 'tool',
          content: [{ type: 'tool_result', toolCallId: 'call_0', name: 'get_position', content: '{"x":1,"y":2,"z":3}' }]
        }
      ],
      tools: [],
      signal: new AbortController().signal
    });

    const body = JSON.parse(fakeFetch.mock.calls[0][1].body);
    // Third content is the tool role -> functionResponse
    const toolContent = body.contents[2];
    expect(toolContent.role).toBe('user');
    const fr = toolContent.parts[0].functionResponse;
    expect(fr.name).toBe('get_position');
    expect(fr.response).toEqual({ content: '{"x":1,"y":2,"z":3}' });
  });

  it('honors AbortSignal', async () => {
    const fakeFetch = jest.fn((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })
    );
    const ctrl = new AbortController();
    const provider = new GeminiProvider(
      { provider: 'gemini', model: 'm', apiKey: 'k' },
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
    const provider = new GeminiProvider(
      { provider: 'gemini', model: 'm', apiKey: 'k' },
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
