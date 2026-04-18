import type { LLMProvider, Message } from './providers/types';
import type { ToolExecutor } from './tools/executor';
import type { ToolContext } from './tools/types';
import logger from '../../utils/logger';
import { SYSTEM_PROMPT } from './system_prompt';

export interface SessionDeps {
  bot: any;
  provider: LLMProvider;
  toolExecutor: ToolExecutor;
  targetExecutor: any;
  agentActionExecutor: any;
  safeChat: (msg: string) => void;
  idleMs?: number;
  maxToolsPerSession?: number;
}

export class AgentSession {
  private messages: Message[] = [];
  private abort: AbortController = new AbortController();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private state: 'empty' | 'running' | 'idle' | 'dead' = 'empty';
  private toolsUsedThisSession = 0;
  private readonly idleMs: number;
  private readonly maxTools: number;

  constructor(private readonly deps: SessionDeps) {
    this.idleMs = deps.idleMs ?? 30_000;
    this.maxTools = deps.maxToolsPerSession ?? 30;
  }

  isActive(): boolean {
    return this.state === 'running' || this.state === 'idle';
  }

  async submitUserMessage(
    text: string,
    metadata: { speaker: string; position?: { x: number; y: number; z: number } }
  ): Promise<void> {
    if (this.state === 'dead') this.reset();
    const wrapped = this.wrapUserMessage(text, metadata);

    if (this.state === 'running') {
      // Mid-turn interruption: abort current tool, append new user message, loop will pick it up.
      this.abort.abort();
      this.abort = new AbortController();
    }

    this.messages.push({ role: 'user', content: wrapped });
    this.clearIdleTimer();

    if (this.state === 'idle' || this.state === 'empty') {
      this.state = 'running';
      this.run().catch(err => logger.info(`AgentSession: loop crashed: ${err?.message ?? err}`));
    }
    // If already running, the existing loop will see the new message after the abort resolves.
  }

  destroy(): void {
    this.abort.abort();
    this.clearIdleTimer();
    this.state = 'dead';
    this.messages = [];
  }

  private async run(): Promise<void> {
    while (this.state === 'running') {
      const tools = this.deps.toolExecutor.schemas();
      const result = await this.deps.provider.runTurn({
        system: SYSTEM_PROMPT,
        messages: this.messages,
        tools: this.toolsUsedThisSession >= this.maxTools ? [] : tools,
        signal: this.abort.signal
      });

      if ((this.state as string) === 'dead') return;

      if (result.stopReason === 'cancelled') {
        // Provider aborted mid-turn (either by new user message, or destroy). If a new user
        // message is already appended, loop and process it; otherwise exit.
        if (this.lastMessageIsUser()) continue;
        break;
      }
      if (result.stopReason === 'error') {
        this.deps.safeChat('(agent error — try again)');
        break;
      }

      // Append assistant turn.
      const content: any[] = [];
      if (result.text) content.push({ type: 'text', text: result.text });
      for (const tc of result.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      this.messages.push({ role: 'assistant', content });

      if (result.toolCalls.length === 0) {
        // End of goal.
        if (result.text) this.deps.safeChat(result.text);
        this.state = 'idle';
        this.armIdleTimer();
        return;
      }

      // Execute each tool sequentially; append tool_result.
      for (const call of result.toolCalls) {
        this.toolsUsedThisSession++;
        const ctx: ToolContext = {
          bot: this.deps.bot,
          signal: this.abort.signal,
          targetExecutor: this.deps.targetExecutor,
          agentActionExecutor: this.deps.agentActionExecutor,
          safeChat: this.deps.safeChat
        };
        const toolResult = await this.deps.toolExecutor.run(call, ctx);
        if ((this.state as string) === 'dead') return;
        this.messages.push({
          role: 'tool',
          content: [{
            type: 'tool_result',
            toolCallId: call.id,
            content: JSON.stringify(toolResult),
            isError: !toolResult.ok
          }]
        });
        if (this.abort.signal.aborted) break;
      }
    }
  }

  private wrapUserMessage(
    text: string,
    meta: { speaker: string; position?: { x: number; y: number; z: number } }
  ): string {
    const pos = meta.position
      ? `at (${meta.position.x.toFixed(0)}, ${meta.position.y.toFixed(0)}, ${meta.position.z.toFixed(0)})`
      : '';
    return `[from: ${meta.speaker} ${pos}]\n${text}`;
  }

  private lastMessageIsUser(): boolean {
    return this.messages[this.messages.length - 1]?.role === 'user';
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => { this.reset(); }, this.idleMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private reset(): void {
    this.messages = [];
    this.abort = new AbortController();
    this.toolsUsedThisSession = 0;
    this.state = 'empty';
    this.clearIdleTimer();
  }
}
