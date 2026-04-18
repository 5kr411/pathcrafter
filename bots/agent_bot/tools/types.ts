import type { ToolSchema } from '../providers/types';

export interface TargetExecutorLike {
  setTargets(targets: { item: string; count: number }[]): void;
  startNextTarget(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getTargets(): { item: string; count: number }[];
  resetAndRestart?(): void;
}

export interface AgentActionExecutorLike {
  /** Returns the action's `result()` value (shaped like ToolResult). */
  run(action: any, signal: AbortSignal): Promise<any>;
  stop(): void;
}

export interface ToolContext {
  bot: any;
  signal: AbortSignal;
  /** Reference to the CollectorControlStack-managed collect flow (set by agent_bot.ts). */
  targetExecutor: TargetExecutorLike;
  agentActionExecutor: AgentActionExecutorLike;
  safeChat: (msg: string) => void;
}

export type ToolResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; partial?: unknown; cancelled?: boolean; preempted?: boolean };

export interface ToolImpl {
  schema: ToolSchema;
  execute(input: any, ctx: ToolContext): Promise<ToolResult>;
}
