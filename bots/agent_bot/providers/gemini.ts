import type { LLMProvider, ProviderConfig, TurnParams, TurnResult, Message, ContentBlock } from './types';
import { withTimeout, isTimeoutAbort } from '../../../utils/abortable';

type FetchFn = typeof fetch;

const PROVIDER_FETCH_TIMEOUT_MS = 60_000;

export class GeminiProvider implements LLMProvider {
  private readonly base: string;

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchImpl: FetchFn = fetch
  ) {
    if (!config.apiKey) throw new Error('GeminiProvider: apiKey required');
    this.base = (config.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  }

  label(): string { return `gemini:${this.config.model}`; }

  async runTurn(params: TurnParams): Promise<TurnResult> {
    const url = `${this.base}/v1beta/models/${this.config.model}:generateContent`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
    const body: any = {
      contents: params.messages.map(m => this.translateMessage(m))
    };
    if (params.system) {
      body.systemInstruction = { parts: [{ text: params.system }] };
    }
    if (params.tools.length > 0) {
      body.tools = [{
        functionDeclarations: params.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }))
      }];
    }
    if (this.config.maxTokens !== undefined) {
      body.generationConfig = { maxOutputTokens: this.config.maxTokens };
    }

    const { signal, cleanup } = withTimeout(params.signal, PROVIDER_FETCH_TIMEOUT_MS);
    try {
      let resp: Response;
      try {
        resp = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.config.apiKey!
          },
          body: JSON.stringify(body),
          signal
        });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch clause default type
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
        const raw = await resp.text().catch(() => '');
        let detail: string;
        try { detail = JSON.parse(raw)?.error?.message ?? `HTTP ${resp.status}`; }
        catch { detail = raw ? raw.slice(0, 200) : `HTTP ${resp.status}`; }
        return { text: null, toolCalls: [], stopReason: 'error', errorDetail: detail };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
      const data: any = await resp.json();
      const candidate = data.candidates?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
      const parts: any[] = candidate?.content?.parts ?? [];

      let text: string | null = null;
      const toolCalls: TurnResult['toolCalls'] = [];
      let callIndex = 0;
      for (const part of parts) {
        if (typeof part.text === 'string') {
          text = (text ?? '') + part.text;
        } else if (part.functionCall) {
          toolCalls.push({
            id: `call_${callIndex}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {}
          });
          callIndex++;
        }
      }

      const stopReason: TurnResult['stopReason'] =
        toolCalls.length > 0 ? 'tool_use' :
        candidate?.finishReason === 'STOP' ? 'end' :
        'error';

      const usage = data.usageMetadata
        ? {
            inputTokens: data.usageMetadata.promptTokenCount ?? 0,
            outputTokens: data.usageMetadata.candidatesTokenCount ?? 0
          }
        : undefined;

      return { text, toolCalls, stopReason, usage };
    } finally {
      cleanup();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
  private translateMessage(m: Message): any {
    if (m.role === 'tool') {
      if (typeof m.content === 'string') {
        return {
          role: 'user',
          parts: [{ functionResponse: { name: '', response: { content: m.content } } }]
        };
      }
      const blocks = m.content as ContentBlock[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
      const first = blocks.find(b => b.type === 'tool_result') as any;
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: first?.name ?? '',
            response: { content: first?.content ?? '' }
          }
        }]
      };
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      return { role, parts: [{ text: m.content }] };
    }
    const blocks = m.content as ContentBlock[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM trust boundary
    const parts: any[] = [];
    for (const b of blocks) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'tool_use') parts.push({ functionCall: { name: b.name, args: b.input ?? {} } });
    }
    return { role, parts };
  }
}
