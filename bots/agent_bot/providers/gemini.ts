import type { LLMProvider, ProviderConfig, TurnParams, TurnResult, Message, ContentBlock } from './types';

type FetchFn = typeof fetch;

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
    const url = `${this.base}/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

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

    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: params.signal
      });
    } catch (_err: any) {
      if (params.signal.aborted) return { text: null, toolCalls: [], stopReason: 'cancelled' };
      return { text: null, toolCalls: [], stopReason: 'error' };
    }

    if (!resp.ok) {
      return { text: null, toolCalls: [], stopReason: 'error' };
    }

    const data: any = await resp.json();
    const candidate = data.candidates?.[0];
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
  }

  private translateMessage(m: Message): any {
    if (m.role === 'tool') {
      if (typeof m.content === 'string') {
        return {
          role: 'user',
          parts: [{ functionResponse: { name: '', response: { content: m.content } } }]
        };
      }
      const blocks = m.content as ContentBlock[];
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
    const parts: any[] = [];
    for (const b of blocks) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'tool_use') parts.push({ functionCall: { name: b.name, args: b.input ?? {} } });
    }
    return { role, parts };
  }
}
