import type { LLMProvider, ProviderConfig, TurnParams, TurnResult, Message, ContentBlock } from './types';

export type FetchFn = typeof fetch;

export class OpenAIProvider implements LLMProvider {
  protected readonly url: string;

  constructor(
    protected readonly config: ProviderConfig,
    protected readonly fetchImpl: FetchFn = fetch
  ) {
    this.validateConfig();
    const base = config.baseUrl ?? 'https://api.openai.com';
    this.url = `${base.replace(/\/$/, '')}/v1/chat/completions`;
  }

  protected validateConfig(): void {
    if (!this.config.apiKey) throw new Error('OpenAIProvider: apiKey required');
  }

  label(): string { return `openai:${this.config.model}`; }

  async runTurn(params: TurnParams): Promise<TurnResult> {
    const messages: any[] = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    for (const m of params.messages) messages.push(this.translateMessage(m));

    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      messages,
      tools: params.tools.length > 0
        ? params.tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema }
          }))
        : undefined
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    let resp: Response;
    try {
      resp = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
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
    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};
    const text: string | null = typeof msg.content === 'string' && msg.content.length > 0 ? msg.content : null;

    const toolCalls: TurnResult['toolCalls'] = [];
    for (const tc of msg.tool_calls ?? []) {
      const name = tc?.function?.name ?? '';
      const argsStr = tc?.function?.arguments ?? '{}';
      let input: unknown = {};
      try { input = argsStr ? JSON.parse(argsStr) : {}; } catch { input = argsStr; }
      toolCalls.push({ id: tc.id, name, input });
    }

    const finish = choice?.finish_reason;
    const stopReason: TurnResult['stopReason'] =
      finish === 'tool_calls' ? 'tool_use' :
      finish === 'stop' || finish === 'length' ? 'end' :
      toolCalls.length > 0 ? 'tool_use' :
      'end';

    return {
      text,
      toolCalls,
      stopReason,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined
    };
  }

  private translateMessage(m: Message): any {
    if (m.role === 'tool') {
      if (typeof m.content === 'string') {
        return { role: 'tool', tool_call_id: '', content: m.content };
      }
      const blocks = m.content as ContentBlock[];
      const first = blocks.find(b => b.type === 'tool_result') as any;
      return {
        role: 'tool',
        tool_call_id: first?.toolCallId ?? '',
        content: first?.content ?? ''
      };
    }
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }
    const blocks = m.content as ContentBlock[];
    const textBlocks = blocks.filter(b => b.type === 'text') as any[];
    const toolUses = blocks.filter(b => b.type === 'tool_use') as any[];
    const text = textBlocks.map(b => b.text).join('');
    const base: any = { role: m.role, content: text || null };
    if (toolUses.length > 0) {
      base.tool_calls = toolUses.map(b => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
      }));
    }
    return base;
  }
}
