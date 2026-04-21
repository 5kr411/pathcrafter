import type { ToolSchema } from '../providers/types';
import type { Bot } from '../../../behavior_generator/types';
import type { AgentAction } from '../action_executor';

export interface TargetExecutorLike {
  setTargets(targets: { item: string; count: number }[]): void;
  startNextTarget(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getTargets(): { item: string; count: number }[];
  resetAndRestart?(): void;
}

export interface AgentActionExecutorLike {
  /**
   * Returns the action's `result()` value (shaped like ToolResult).
   * Typed as `Promise<unknown>` here to avoid a circular import between
   * `types.ts` and `action_executor.ts` (this file imports `AgentAction`
   * from `action_executor.ts`; if `action_executor.ts` then imported
   * `ToolResult` back from here, we'd have a cycle). Callers narrow at
   * the call site.
   */
  run(action: AgentAction, signal: AbortSignal): Promise<unknown>;
  stop(): void;
}

export interface ToolContext {
  bot: Bot;
  signal: AbortSignal;
  /** Reference to the CollectorControlStack-managed collect flow (set by agent_bot.ts). */
  targetExecutor: TargetExecutorLike;
  agentActionExecutor: AgentActionExecutorLike;
  safeChat: (msg: string) => void;
}

export type ToolResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; partial?: unknown; cancelled?: boolean; preempted?: boolean };

export interface ToolImpl<TInput = unknown> {
  schema: ToolSchema;
  execute(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}
