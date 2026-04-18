import { createProvider } from '../../../../bots/agent_bot/providers/factory';

describe('createProvider', () => {
  it('creates anthropic provider', () => {
    const p = createProvider({ provider: 'anthropic', model: 'm', apiKey: 'k' });
    expect(p.label()).toBe('anthropic:m');
  });
  it('creates openai provider', () => {
    const p = createProvider({ provider: 'openai', model: 'm', apiKey: 'k' });
    expect(p.label()).toBe('openai:m');
  });
  it('creates gemini provider', () => {
    const p = createProvider({ provider: 'gemini', model: 'm', apiKey: 'k' });
    expect(p.label()).toBe('gemini:m');
  });
  it('creates openai-compat provider', () => {
    const p = createProvider({ provider: 'openai-compat', model: 'm', baseUrl: 'http://x' });
    expect(p.label()).toBe('openai-compat:m');
  });
  it('errors on missing required field', () => {
    expect(() => createProvider({ provider: 'anthropic', model: 'm' } as any)).toThrow(/apiKey/);
  });
  it('errors on missing baseUrl for openai-compat', () => {
    expect(() => createProvider({ provider: 'openai-compat', model: 'm' } as any)).toThrow(/baseUrl/);
  });
  it('throws on unknown provider', () => {
    expect(() => createProvider({ provider: 'nope', model: 'm' } as any)).toThrow(/unknown provider/);
  });
});
