export type Role = 'user' | 'assistant' | 'tool';

export interface TextBlock { type: 'text'; text: string; }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown; }
export interface ToolResultBlock { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean; name?: string; }
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type StopReason = 'end' | 'tool_use' | 'cancelled' | 'error';

export interface TurnResult {
  text: string | null;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage?: { inputTokens: number; outputTokens: number };
  /** Short human-readable error detail when stopReason is 'error'. */
  errorDetail?: string;
}

export interface TurnParams {
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  signal: AbortSignal;
}

export interface LLMProvider {
  runTurn(params: TurnParams): Promise<TurnResult>;
  label(): string;
}

export interface ProviderConfig {
  provider: 'anthropic' | 'openai' | 'gemini' | 'openai-compat';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
}
