import type { ToolSchema } from '../providers/types';

export interface ToolContext {
  bot: any;
  signal: AbortSignal;
  /** Reference to the CollectorControlStack-managed collect flow (set by agent_bot.ts). */
  targetExecutor: any;
  agentActionExecutor: any;
  safeChat: (msg: string) => void;
}

export type ToolResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; partial?: unknown; cancelled?: boolean; preempted?: boolean };

export interface ToolImpl {
  schema: ToolSchema;
  execute(input: any, ctx: ToolContext): Promise<ToolResult>;
}
