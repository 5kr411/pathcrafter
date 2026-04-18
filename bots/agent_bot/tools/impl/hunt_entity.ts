import type { ToolImpl } from '../types';
import type { AgentAction } from '../../action_executor';

/**
 * Pursue and kill an entity by id. Uses mineflayer-pvp's `bot.pvp.attack()`
 * which handles both approach and striking. We monitor the entity each tick
 * to detect death, despawn, or being stuck >10s beyond 64 blocks.
 *
 * For a richer state-machine version see `behaviors/behaviorHuntEntity.ts`,
 * but wrapping that inside an AgentAction adds complexity we don't need here.
 */
export const huntEntityTool: ToolImpl = {
  schema: {
    name: 'hunt_entity',
    description: 'Pursue and attack a specific entity (mob, animal, player) by its entity id until it dies, despawns, or times out. Use for explicit "kill that" / "go attack" goals. Do NOT use to farm for food (collect_item with cooked_beef or similar is better — the planner handles the full loop including cooking). For getting food from mobs, prefer collect_item. Get entity ids from get_entities.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'number' },
        timeout: { type: 'number', minimum: 1, maximum: 3600, description: 'seconds' }
      },
      required: ['entityId']
    }
  },
  async execute(input, ctx) {
    const { entityId, timeout = 300 } = input as any;
    if (typeof entityId !== 'number') {
      return { ok: false, error: 'entityId must be a number' };
    }
    const deadline = Date.now() + timeout * 1000;
    const FAR_THRESHOLD = 64;
    const FAR_GRACE_MS = 10_000;
    const MISSING_GRACE_MS = 2_000;

    let target: any = null;
    let killed = false;
    let lost = false;
    let farSince = 0;
    let missingSince = 0;

    const resolve = (): any | null => {
      return ctx.bot?.entities?.[entityId] || null;
    };

    const action: AgentAction = {
      name: 'hunt_entity',
      start(bot) {
        target = resolve();
        if (!target) {
          // Entity never resolved at start — treat as lost immediately (no grace).
          lost = true;
          return;
        }
        try {
          if (bot.pvp && typeof bot.pvp.attack === 'function') {
            bot.pvp.attack(target);
          } else if (typeof bot.attack === 'function') {
            // Fallback: single attack (mineflayer-pvp should normally be loaded)
            bot.attack(target);
          }
        } catch (_) { /* ignore, we retry on update */ }
      },
      update() {
        const e = resolve();
        if (!e) {
          // Entity missing. Use a grace window to tolerate chunk unloads / view
          // distance blips. Only flag lost if it stays gone past grace.
          if (!missingSince) missingSince = Date.now();
          if (Date.now() - missingSince > MISSING_GRACE_MS) {
            lost = true;
          }
          return;
        }
        // Entity is back — clear the missing-since clock.
        missingSince = 0;
        target = e;
        // Explicit death flag: killed.
        if (typeof e.isValid === 'boolean' && !e.isValid) {
          killed = true;
          return;
        }
        const botPos = ctx.bot?.entity?.position;
        if (botPos && e.position) {
          const d = Math.hypot(
            botPos.x - e.position.x,
            botPos.y - e.position.y,
            botPos.z - e.position.z
          );
          if (d > FAR_THRESHOLD) {
            if (!farSince) farSince = Date.now();
            if (Date.now() - farSince > FAR_GRACE_MS) {
              lost = true;
            }
          } else {
            farSince = 0;
          }
        }
        // If pvp dropped its target (attack resolved), re-issue.
        try {
          if (ctx.bot?.pvp && ctx.bot.pvp.target !== e && typeof ctx.bot.pvp.attack === 'function') {
            ctx.bot.pvp.attack(e);
          }
        } catch (_) {}
      },
      stop() {
        try { ctx.bot?.pvp?.stop?.(); } catch (_) {}
        try { ctx.bot?.pathfinder?.stop?.(); } catch (_) {}
      },
      isFinished() {
        if (killed || lost) return true;
        if (Date.now() >= deadline) return true;
        const e = resolve();
        if (!e) {
          // Still within grace → not finished yet.
          if (!missingSince) missingSince = Date.now();
          if (Date.now() - missingSince > MISSING_GRACE_MS) {
            lost = true;
            return true;
          }
          return false;
        }
        if (typeof e.isValid === 'boolean' && !e.isValid) {
          killed = true;
          return true;
        }
        return false;
      },
      result() {
        if (killed) return { ok: true, data: { killed: true, entityId } };
        if (lost) return { ok: false, error: 'lost' };
        if (Date.now() >= deadline) return { ok: false, error: 'timeout' };
        return { ok: false, error: 'stopped' };
      }
    };

    return ctx.agentActionExecutor.run(action, ctx.signal);
  }
};
