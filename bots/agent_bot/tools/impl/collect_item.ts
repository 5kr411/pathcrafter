import type { ToolImpl, TargetExecutorLike } from '../types';
import { getInventoryObject } from '../../../../utils/inventory';

type CollectItemInput = { targets: { item: string; count: number }[] };

export const collectItemTool: ToolImpl<CollectItemInput> = {
  schema: {
    name: 'collect_item',
    description: 'Acquire items by name and count. Targets must be END GOALS — the items you want in your inventory when the task is done. The planner handles all mining, crafting, smelting, prerequisite tools, and workstations automatically, and the reactive safety layer handles combat/food/shelter. Do NOT decompose a crafted target into its raw materials: pass {item: "wooden_pickaxe", count: 1} — not "oak_log" then "oak_planks" then "stick". When a target is part of a variant family (any *_log, *_planks, *_stairs, etc.), the planner will NOT substitute one species for another at the target level — hardcoding a species causes wandering if the current biome lacks it. Target the crafted item instead; the planner picks a biome-available species for ingredient resolution. Prefer a single call with the full target list over sequential calls.',
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
    const targets = input?.targets;
    if (!Array.isArray(targets) || targets.length === 0) {
      return { ok: false, error: 'targets must be a non-empty array' };
    }
    const invBefore = getInventoryObject(ctx.bot);
    ctx.targetExecutor.setTargets(targets);

    const onAbort = () => {
      // Hard-cancel: stop() alone is soft — the underlying state machine can
      // still be waiting on an in-flight planning job from the worker, which
      // returns seconds later and auto-resumes the suspended plan. Clear the
      // target list so there's nothing left to resume to, then stop.
      try { ctx.targetExecutor.setTargets([]); } catch (_) {}
      try { ctx.targetExecutor.stop(); } catch (_) {}
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      await ctx.targetExecutor.startNextTarget();
      await waitUntilIdle(ctx.targetExecutor, ctx.signal);
    } catch (err) {
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

function waitUntilIdle(executor: TargetExecutorLike, signal: AbortSignal, pollMs = 500): Promise<void> {
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
