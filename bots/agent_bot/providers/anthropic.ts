import type { LLMProvider, ProviderConfig, TurnParams, TurnResult, Message, ContentBlock } from './types';
import { withTimeout, isTimeoutAbort } from '../../../utils/abortable';

type FetchFn = typeof fetch;

const PROVIDER_FETCH_TIMEOUT_MS = 60_000;

export class AnthropicProvider implements LLMProvider {
  private readonly url: string;

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchImpl: FetchFn = fetch
  ) {
    if (!config.apiKey) throw new Error('AnthropicProvider: apiKey required');
    const base = config.baseUrl ?? 'https://api.anthropic.com';
    this.url = `${base.replace(/\/$/, '')}/v1/messages`;
  }

  label(): string { return `anthropic:${this.config.model}`; }

  async runTurn(params: TurnParams): Promise<TurnResult> {
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      system: params.system,
      messages: params.messages.map(m => this.translateMessage(m)),
      tools: params.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema
      }))
    };

    const { signal, cleanup } = withTimeout(params.signal, PROVIDER_FETCH_TIMEOUT_MS);
    try {
      let resp: Response;
      try {
        resp = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.config.apiKey!,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body),
          signal
        });
      } catch (err: any) {
        if (params.signal.aborted) return { text: null, toolCalls: [], stopReason: 'cancelled' };
        if (isTimeoutAbort(signal)) {
          return {
            text: null, toolCalls: [], stopReason: 'error',
            errorDetail: `provider timeout after ${PROVIDER_FETCH_TIMEOUT_MS}ms`
          };
        }
        return { text: null, toolCalls: [], stopReason: 'error', errorDetail: err?.message ?? String(err) };
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        const detail = extractErrorMessage(body) ?? `HTTP ${resp.status}`;
        return { text: null, toolCalls: [], stopReason: 'error', errorDetail: detail };
      }

      const data: any = await resp.json();
      let text: string | null = null;
      const toolCalls: TurnResult['toolCalls'] = [];

      for (const block of data.content ?? []) {
        if (block.type === 'text') text = (text ?? '') + block.text;
        else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }

      const stopReason: TurnResult['stopReason'] =
        data.stop_reason === 'tool_use' ? 'tool_use' :
        data.stop_reason === 'end_turn' || data.stop_reason === 'stop_sequence' ? 'end' :
        'error';

      return {
        text: text ?? null,
        toolCalls,
        stopReason,
        usage: data.usage
          ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
          : undefined
      };
    } finally {
      cleanup();
    }
  }

  private translateMessage(m: Message): { role: 'user' | 'assistant'; content: any } {
    if (m.role === 'tool') {
      if (typeof m.content === 'string') {
        return { role: 'user', content: [{ type: 'tool_result', tool_use_id: '', content: m.content }] };
      }
      return {
        role: 'user',
        content: (m.content as ContentBlock[]).map(b => b.type === 'tool_result'
          ? { type: 'tool_result', tool_use_id: (b as any).toolCallId, content: (b as any).content, is_error: (b as any).isError }
          : b)
      };
    }
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: (m.content as ContentBlock[]).map(b => {
        if (b.type === 'text') return b;
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        return b;
      })
    };
  }
}

function extractErrorMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message ?? parsed?.message ?? null;
  } catch (_) {
    return body.slice(0, 200);
  }
}
