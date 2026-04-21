import type { ToolImpl, ToolResult } from '../types';
import type { AgentAction } from '../../action_executor';

type GotoEntityInput = {
  entityId: number;
  timeout?: number;
  followDistance?: number;
};

/**
 * Follow a specific entity by id using `GoalFollow`. Re-resolves the entity
 * each tick so transient drops out of `bot.entities` don't confuse us on a
 * single frame — but if the entity disappears and stays gone, we surface
 * `entity lost`.
 */
export const gotoEntityTool: ToolImpl<GotoEntityInput> = {
  schema: {
    name: 'goto_entity',
    description: 'Walk near a tracked entity by id. Blocks until within followDistance, timeout, entity lost, or cancellation.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'number' },
        timeout: { type: 'number', minimum: 1, maximum: 3600, description: 'seconds' },
        followDistance: { type: 'number', minimum: 1, maximum: 32, description: 'blocks' }
      },
      required: ['entityId']
    }
  },
  async execute(input, ctx) {
    const { entityId, timeout = 120, followDistance = 2 } = input ?? ({} as GotoEntityInput);
    if (typeof entityId !== 'number') {
      return { ok: false, error: 'entityId must be a number' };
    }
    const { goals, Movements } = require('mineflayer-pathfinder');
    const deadline = Date.now() + timeout * 1000;
    let missing = false;
    let missingSince = 0;
    const MISSING_GRACE_MS = 1500;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    const resolveEntity = (): any | null => {
      const e = ctx.bot?.entities?.[entityId];
      return e || null;
    };

    const action: AgentAction = {
      name: 'goto_entity',
      start(bot) {
        const e = resolveEntity();
        if (!e) { missing = true; return; }
        try {
          const movements = new Movements(bot);
          bot.pathfinder.setMovements(movements);
        } catch (_) {}
        try { bot.pathfinder.setGoal(new goals.GoalFollow(e, followDistance), true); } catch (_) {}
      },
      update() {
        const e = resolveEntity();
        if (!e) {
          if (!missingSince) missingSince = Date.now();
          if (Date.now() - missingSince > MISSING_GRACE_MS) {
            missing = true;
          }
        } else {
          missingSince = 0;
        }
      },
      stop() {
        try { ctx.bot.pathfinder?.stop?.(); } catch (_) {}
        try { ctx.bot.pathfinder?.setGoal?.(null); } catch (_) {}
      },
      isFinished() {
        if (missing) return true;
        if (Date.now() >= deadline) return true;
        const e = resolveEntity();
        const p = ctx.bot?.entity?.position;
        if (e && p) {
          const d = Math.hypot(p.x - e.position.x, p.y - e.position.y, p.z - e.position.z);
          const moving = typeof ctx.bot?.pathfinder?.isMoving === 'function'
            ? ctx.bot.pathfinder.isMoving()
            : false;
          if (d <= followDistance + 0.5 && !moving) return true;
        }
        return false;
      },
      result() {
        const e = resolveEntity();
        const p = ctx.bot?.entity?.position;
        if (missing) return { ok: false, error: 'entity lost' };
        if (Date.now() >= deadline) {
          return { ok: false, error: 'timeout', partial: p ? { position: { x: p.x, y: p.y, z: p.z } } : undefined };
        }
        if (e && p) {
          const d = Math.hypot(p.x - e.position.x, p.y - e.position.y, p.z - e.position.z);
          if (d <= followDistance + 0.5) {
            return { ok: true, data: { arrivedAt: { x: p.x, y: p.y, z: p.z } } };
          }
        }
        return { ok: false, error: 'stopped', partial: p ? { position: { x: p.x, y: p.y, z: p.z } } : undefined };
      }
    };

    return (await ctx.agentActionExecutor.run(action, ctx.signal)) as ToolResult;
  }
};
