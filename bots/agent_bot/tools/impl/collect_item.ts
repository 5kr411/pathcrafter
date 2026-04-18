import type { ToolImpl } from '../types';
import { getInventoryObject } from '../../../../utils/inventory';

export const collectItemTool: ToolImpl = {
  schema: {
    name: 'collect_item',
    description: 'Collect one or more items by name and count. Uses the planner + full reactive safety layer. Takes a list of targets so multi-item goals use a single planning pass.',
    inputSchema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              item: { type: 'string' },
              count: { type: 'number', minimum: 1 }
            },
            required: ['item', 'count']
          }
        }
      },
      required: ['targets']
    }
  },
  async execute(input, ctx) {
    const targets = (input as any)?.targets as { item: string; count: number }[];
    if (!Array.isArray(targets) || targets.length === 0) {
      return { ok: false, error: 'targets must be a non-empty array' };
    }
    const invBefore = getInventoryObject(ctx.bot);
    ctx.targetExecutor.setTargets(targets);

    const onAbort = () => {
      try { ctx.targetExecutor.stop(); } catch (_) {}
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      await ctx.targetExecutor.startNextTarget();
      await waitUntilIdle(ctx.targetExecutor, ctx.signal);
    } catch (err: any) {
      if (ctx.signal.aborted) {
        const invAfter = getInventoryObject(ctx.bot);
        return { ok: false, error: 'cancelled', cancelled: true, partial: diff(invBefore, invAfter) };
      }
      throw err;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }

    const invAfter = getInventoryObject(ctx.bot);
    const acquired = diff(invBefore, invAfter);
    const missing: Record<string, number> = {};
    for (const t of targets) {
      const got = acquired[t.item] ?? 0;
      if (got < t.count) missing[t.item] = t.count - got;
    }
    return { ok: true, data: { acquired, missing } };
  }
};

function waitUntilIdle(executor: any, signal: AbortSignal, pollMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    let iv: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (iv) { clearInterval(iv); iv = null; }
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(new Error('aborted')); };
    iv = setInterval(() => {
      if (signal.aborted) { cleanup(); return reject(new Error('aborted')); }
      if (!executor.isRunning() || (executor.getTargets?.() ?? []).length === 0) {
        cleanup();
        resolve();
      }
    }, pollMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function diff(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const d: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = (after[k] ?? 0) - (before[k] ?? 0);
    if (delta > 0) d[k] = delta;
  }
  return d;
}
