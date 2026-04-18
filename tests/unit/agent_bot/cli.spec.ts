import { parseAgentBotArgs } from '../../../bots/agent_bot/cli';

describe('parseAgentBotArgs', () => {
  afterEach(() => {
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('parses flags', () => {
    const r = parseAgentBotArgs([
      'localhost', '25565', 'bot1',
      '--provider', 'anthropic',
      '--model', 'claude-sonnet-4-6'
    ], { ANTHROPIC_API_KEY: 'sk' });
    expect(r).toMatchObject({
      host: 'localhost', port: 25565, username: 'bot1',
      provider: { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk' }
    });
  });

  it('falls back to env', () => {
    const r = parseAgentBotArgs(['localhost', '25565', 'bot1'],
      { AGENT_PROVIDER: 'openai', AGENT_MODEL: 'gpt-4.1', OPENAI_API_KEY: 'sk' });
    expect(r.provider.provider).toBe('openai');
  });

  it('errors on missing API key for named provider', () => {
    expect(() => parseAgentBotArgs(['localhost', '25565', 'bot1', '--provider', 'anthropic', '--model', 'm'], {}))
      .toThrow(/ANTHROPIC_API_KEY/);
  });

  it('openai-compat uses AGENT_API_KEY fallback + AGENT_BASE_URL', () => {
    const r = parseAgentBotArgs(['localhost', '25565', 'bot1', '--provider', 'openai-compat', '--model', 'qwen'],
      { AGENT_BASE_URL: 'http://localhost:11434/v1', AGENT_API_KEY: 'ollama' });
    expect(r.provider.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('parses --targets', () => {
    const r = parseAgentBotArgs(['h', '1', 'b', '--provider', 'anthropic', '--model', 'm', '--targets', 'oak_log 5, coal 3'],
      { ANTHROPIC_API_KEY: 'k' });
    expect(r.targets).toEqual([{ item: 'oak_log', count: 5 }, { item: 'coal', count: 3 }]);
  });
});
