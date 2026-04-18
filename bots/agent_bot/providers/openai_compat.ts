import { OpenAIProvider, type FetchFn } from './openai';
import type { ProviderConfig } from './types';

export class OpenAICompatProvider extends OpenAIProvider {
  constructor(config: ProviderConfig, fetchImpl?: FetchFn) {
    if (!config.baseUrl) throw new Error('OpenAICompatProvider: baseUrl required');
    super(config, fetchImpl);
  }

  protected override validateConfig(): void {
    // apiKey is optional for local / self-hosted OpenAI-compatible servers
  }

  override label(): string { return `openai-compat:${this.config.model}`; }
}
