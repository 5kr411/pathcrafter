import { OpenAICompatProvider } from '../../../../bots/agent_bot/providers/openai_compat';

describe('OpenAICompatProvider', () => {
  it('throws when baseUrl is missing', () => {
    expect(() =>
      new OpenAICompatProvider({ provider: 'openai-compat', model: 'llama-3' } as any)
    ).toThrow(/baseUrl/);
  });

  it('label returns openai-compat:${model}', () => {
    const p = new OpenAICompatProvider(
      { provider: 'openai-compat', model: 'llama-3', baseUrl: 'http://localhost:1234' },
      (jest.fn() as any)
    );
    expect(p.label()).toBe('openai-compat:llama-3');
  });

  it('works without apiKey against a fake server and omits Authorization', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'hello' }
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 }
      })
    });
    const provider = new OpenAICompatProvider(
      { provider: 'openai-compat', model: 'llama-3', baseUrl: 'http://localhost:1234' },
      fakeFetch as any
    );
    const result = await provider.runTurn({
      system: '',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: new AbortController().signal
    });
    expect(result.stopReason).toBe('end');
    expect(result.text).toBe('hello');

    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('includes Authorization when apiKey is provided', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 }
      })
    });
    const provider = new OpenAICompatProvider(
      { provider: 'openai-compat', model: 'llama-3', baseUrl: 'http://localhost:1234', apiKey: 'secret' },
      fakeFetch as any
    );
    await provider.runTurn({
      system: '',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      signal: new AbortController().signal
    });
    const [, init] = fakeFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer secret');
  });
});
