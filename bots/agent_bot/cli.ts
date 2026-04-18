import type { ProviderConfig } from './providers/types';

export interface AgentBotConfig {
  host: string;
  port: number;
  username: string;
  provider: ProviderConfig;
  targets?: { item: string; count: number }[];
}

export function parseAgentBotArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): AgentBotConfig {
  if (argv.length < 3) throw new Error('usage: <host> <port> <username> [flags]');
  const [host, portStr, username, ...rest] = argv;
  const port = parseInt(portStr, 10);
  if (!Number.isFinite(port)) throw new Error(`invalid port: ${portStr}`);

  const get = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 && i + 1 < rest.length ? rest[i + 1] : undefined;
  };

  const provider = (get('--provider') ?? env.AGENT_PROVIDER) as ProviderConfig['provider'] | undefined;
  const model = get('--model') ?? env.AGENT_MODEL;
  const baseUrl = get('--base-url') ?? env.AGENT_BASE_URL;

  if (!provider) throw new Error('--provider or AGENT_PROVIDER required (anthropic|openai|gemini|openai-compat)');
  if (!model) throw new Error('--model or AGENT_MODEL required');
  if (!['anthropic', 'openai', 'gemini', 'openai-compat'].includes(provider)) {
    throw new Error(`unknown provider: ${provider}`);
  }

  let apiKey: string | undefined;
  if (provider === 'anthropic') {
    apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var required');
  } else if (provider === 'openai') {
    apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY env var required');
  } else if (provider === 'gemini') {
    apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY env var required');
  } else {
    apiKey = env.AGENT_API_KEY;
    if (!baseUrl) throw new Error('--base-url or AGENT_BASE_URL required for openai-compat');
  }

  const targetsStr = get('--targets');
  const targets = targetsStr
    ? targetsStr.split(',').map(s => {
        const raw = s.trim();
        const [item, c] = raw.split(/\s+/);
        const count = parseInt(c, 10);
        if (!item || !Number.isInteger(count) || count < 1) {
          throw new Error(`invalid target "${raw}": count must be a positive integer (e.g. "oak_log 5")`);
        }
        return { item, count };
      })
    : undefined;

  return {
    host,
    port,
    username,
    provider: { provider, model, baseUrl, apiKey },
    targets
  };
}
