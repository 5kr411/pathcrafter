import type { ToolImpl, ToolResult } from '../types';
import type { AgentAction } from '../../action_executor';
import createHuntEntityState from '../../../../behaviors/behaviorHuntEntity';
import { createTrackedBotStateMachine } from '../../../collector/state_machine_utils';

type HuntEntityInput = {
  entityId: number;
  timeout?: number;
};

export const huntEntityTool: ToolImpl<HuntEntityInput> = {
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
    const { entityId, timeout = 300 } = input ?? ({} as HuntEntityInput);
    if (typeof entityId !== 'number') {
      return { ok: false, error: 'entityId must be a number' };
    }
    const deadline = Date.now() + timeout * 1000;

    const targetEntity = ctx.bot?.entities?.[entityId];
    if (!targetEntity) {
      return { ok: false, error: 'entity not found' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    const targets: any = {
      entity: targetEntity,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
      entityFilter: (e: any) => !!e && e.id === entityId,
      detectionRange: 48,
      attackRange: 3.5
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    const stateMachine: any = createHuntEntityState(ctx.bot as any, targets);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    let tracked: { listener: (...args: any[]) => void } | null = null;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (tracked) {
        try { ctx.bot.removeListener('physicsTick', tracked.listener); } catch (_) {}
        try { ctx.bot.removeListener('physicTick', tracked.listener); } catch (_) {}
      }
      try { stateMachine.active = false; } catch (_) {}
      try { stateMachine.onStateExited?.(); } catch (_) {}
      try { ctx.bot?.pvp?.stop?.(); } catch (_) {}
      try { ctx.bot?.pathfinder?.stop?.(); } catch (_) {}
      try { ctx.bot?.pathfinder?.setGoal?.(null); } catch (_) {}
    };

    const action: AgentAction = {
      name: 'hunt_entity',
      start(bot) {
        tracked = createTrackedBotStateMachine(bot, stateMachine);
        try { bot.on('physicsTick', tracked.listener); } catch (_) {}
        try { bot.on('physicTick', tracked.listener); } catch (_) {}
        try { stateMachine.active = true; } catch (_) {}
        try { stateMachine.onStateEntered?.(); } catch (_) {}
      },
      update() {
        // State machine ticks itself via the physicsTick listener.
      },
      stop() {
        cleanup();
      },
      isFinished() {
        if (Date.now() >= deadline) return true;
        const e = ctx.bot?.entities?.[entityId];
        if (!e) return true;
        if (typeof e.isValid === 'boolean' && !e.isValid) return true;
        if (typeof stateMachine.isFinished === 'function' && stateMachine.isFinished()) return true;
        return false;
      },
      result() {
        const e = ctx.bot?.entities?.[entityId];
        const killed = !e || (typeof e.isValid === 'boolean' && !e.isValid);
        if (killed) return { ok: true, data: { killed: true, entityId } };
        if (Date.now() >= deadline) return { ok: false, error: 'timeout' };
        return { ok: false, error: 'stopped' };
      }
    };

    return (await ctx.agentActionExecutor.run(action, ctx.signal)) as ToolResult;
  }
};
