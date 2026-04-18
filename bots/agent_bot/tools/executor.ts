import type { ToolCall, ToolSchema } from '../providers/types';
import type { ToolImpl, ToolContext, ToolResult } from './types';

export class ToolExecutor {
  private readonly byName = new Map<string, ToolImpl>();

  constructor(tools: ToolImpl[]) {
    for (const t of tools) this.byName.set(t.schema.name, t);
  }

  schemas(): ToolSchema[] {
    return [...this.byName.values()].map(t => t.schema);
  }

  async run(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const impl = this.byName.get(call.name);
    if (!impl) return { ok: false, error: `unknown tool: ${call.name}` };
    try {
      return await impl.execute(call.input, ctx);
    } catch (err: any) {
      if (ctx.signal.aborted) return { ok: false, error: 'cancelled', cancelled: true };
      return { ok: false, error: err?.message ?? String(err) };
    }
  }
}
