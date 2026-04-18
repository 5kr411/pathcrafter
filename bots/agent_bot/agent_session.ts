import type { LLMProvider, Message } from './providers/types';
import type { ToolExecutor } from './tools/executor';
import type { ToolContext, TargetExecutorLike, AgentActionExecutorLike } from './tools/types';
import logger from '../../utils/logger';
import { SYSTEM_PROMPT } from './system_prompt';

export type { TargetExecutorLike, AgentActionExecutorLike };

export interface SessionDeps {
  bot: any;
  provider: LLMProvider;
  toolExecutor: ToolExecutor;
  targetExecutor: TargetExecutorLike;
  agentActionExecutor: AgentActionExecutorLike;
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
  /** User message arrived while a tool loop was running. Drained by run()
   *  after the current tool batch has pushed all tool_result blocks, so
   *  tool_use/tool_result adjacency is preserved. */
  private pendingUserMessage: string | null = null;
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
    this.clearIdleTimer();

    if (this.state === 'running') {
      // Mid-turn interruption: queue the new message and fire the abort.
      // We must NOT push it to `messages` yet — the in-flight tool loop still
      // has pending tool_result blocks to push for already-issued tool_use
      // blocks in the current assistant turn. Interleaving a user message
      // between a tool_use and its tool_result makes the conversation
      // ill-formed (Anthropic rejects it with a 400). The run loop drains
      // the queue once all tool_results have been pushed.
      this.pendingUserMessage = wrapped;
      this.abort.abort();
      this.abort = new AbortController();
      return;
    }

    this.messages.push({ role: 'user', content: wrapped });

    if (this.state === 'idle' || this.state === 'empty') {
      this.state = 'running';
      this.run().catch(err => logger.info(`AgentSession: loop crashed: ${err?.message ?? err}`));
    }
  }

  destroy(): void {
    this.abort.abort();
    this.clearIdleTimer();
    this.state = 'dead';
    this.messages = [];
    this.pendingUserMessage = null;
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
        // Provider aborted mid-turn (either by new user message, or destroy).
        // If a new user message is queued (or already appended), continue;
        // otherwise exit.
        if (this.drainPendingUserMessage() || this.lastMessageIsUser()) continue;
        break;
      }
      if (result.stopReason === 'error') {
        const detail = result.errorDetail ? `: ${result.errorDetail}` : '';
        this.deps.safeChat(`(agent error${detail})`);
        this.state = 'idle';
        this.armIdleTimer();
        return;
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

      // Execute each tool sequentially; append tool_result for each tool_use.
      // Once the abort fires, synthesize cancelled tool_result entries for
      // remaining tool_uses so the assistant turn stays well-formed.
      let abortedMidBatch = false;
      for (const call of result.toolCalls) {
        if (abortedMidBatch) {
          const synthetic = { ok: false, error: 'cancelled', cancelled: true };
          logger.info(`AgentSession: tool ${call.name} -> synthesized cancelled tool_result (abort mid-batch)`);
          this.messages.push({
            role: 'tool',
            content: [{
              type: 'tool_result',
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify(synthetic),
              isError: true
            }]
          });
          continue;
        }
        this.toolsUsedThisSession++;
        const ctx: ToolContext = {
          bot: this.deps.bot,
          signal: this.abort.signal,
          targetExecutor: this.deps.targetExecutor,
          agentActionExecutor: this.deps.agentActionExecutor,
          safeChat: this.deps.safeChat
        };
        logger.info(`AgentSession: tool call ${call.name} input=${JSON.stringify(call.input).slice(0, 200)}`);
        const toolResult = await this.deps.toolExecutor.run(call, ctx);
        const resSummary = toolResult.ok
          ? `ok data=${JSON.stringify((toolResult as any).data ?? null).slice(0, 200)}`
          : `err=${(toolResult as any).error}${(toolResult as any).cancelled ? ' (cancelled)' : ''}${(toolResult as any).preempted ? ' (preempted)' : ''}`;
        logger.info(`AgentSession: tool ${call.name} -> ${resSummary}`);
        if ((this.state as string) === 'dead') return;
        this.messages.push({
          role: 'tool',
          content: [{
            type: 'tool_result',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(toolResult),
            isError: !toolResult.ok
          }]
        });
        if (this.abort.signal.aborted) abortedMidBatch = true;
      }

      // Drain any user message queued during the tool batch, now that all
      // tool_results have been pushed and tool_use/tool_result adjacency is
      // preserved.
      this.drainPendingUserMessage();
    }
  }

  private drainPendingUserMessage(): boolean {
    if (this.pendingUserMessage === null) return false;
    this.messages.push({ role: 'user', content: this.pendingUserMessage });
    this.pendingUserMessage = null;
    return true;
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
    this.pendingUserMessage = null;
    this.clearIdleTimer();
  }
}
