import type { LLMProvider, ProviderConfig } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { OpenAICompatProvider } from './openai_compat';

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':     return new AnthropicProvider(config);
    case 'openai':        return new OpenAIProvider(config);
    case 'gemini':        return new GeminiProvider(config);
    case 'openai-compat': return new OpenAICompatProvider(config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
    default: throw new Error(`unknown provider: ${(config as any).provider}`);
  }
}
