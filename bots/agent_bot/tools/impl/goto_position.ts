import type { ToolImpl, ToolResult } from '../types';
import type { AgentAction } from '../../action_executor';

type GotoPositionInput = {
  x: number;
  y: number;
  z: number;
  timeout?: number;
};

/**
 * Walk to (x, y, z) via mineflayer-pathfinder. Runs through the
 * `AgentActionExecutor`, so a higher-priority reactive behavior can
 * preempt it and the tool will surface a `preempted` result.
 */
export const gotoPositionTool: ToolImpl<GotoPositionInput> = {
  schema: {
    name: 'goto_position',
    description: 'Walk to the given (x,y,z) using the pathfinder. Blocks until arrived, timeout, or cancellation.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        timeout: { type: 'number', minimum: 1, maximum: 3600, description: 'seconds' }
      },
      required: ['x', 'y', 'z']
    }
  },
  async execute(input, ctx) {
    const { x, y, z, timeout = 120 } = input ?? ({} as GotoPositionInput);
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      return { ok: false, error: 'x, y, z must all be numbers' };
    }
    const { goals, Movements } = require('mineflayer-pathfinder');
    const goal = new goals.GoalNear(x, y, z, 1);
    const deadline = Date.now() + timeout * 1000;

    const action: AgentAction = {
      name: 'goto_position',
      start(bot) {
        try {
          const movements = new Movements(bot);
          bot.pathfinder.setMovements(movements);
        } catch (_) {}
        try { bot.pathfinder.setGoal(goal, true); } catch (_) {}
      },
      update() { /* pathfinder runs async; nothing per tick */ },
      stop() {
        try { ctx.bot.pathfinder?.stop?.(); } catch (_) {}
        try { ctx.bot.pathfinder?.setGoal?.(null); } catch (_) {}
      },
      isFinished() {
        if (Date.now() >= deadline) return true;
        const p = ctx.bot?.entity?.position;
        if (!p) return false;
        const d = Math.hypot(p.x - x, p.y - y, p.z - z);
        const moving = typeof ctx.bot?.pathfinder?.isMoving === 'function'
          ? ctx.bot.pathfinder.isMoving()
          : false;
        if (d < 2 && !moving) return true;
        return false;
      },
      result() {
        const p = ctx.bot?.entity?.position;
        if (p) {
          const d = Math.hypot(p.x - x, p.y - y, p.z - z);
          if (d < 2) {
            return { ok: true, data: { arrivedAt: { x: p.x, y: p.y, z: p.z } } };
          }
          if (Date.now() >= deadline) {
            return { ok: false, error: 'timeout', partial: { position: { x: p.x, y: p.y, z: p.z } } };
          }
          return { ok: false, error: 'stopped', partial: { position: { x: p.x, y: p.y, z: p.z } } };
        }
        return { ok: false, error: 'stopped' };
      }
    };

    return (await ctx.agentActionExecutor.run(action, ctx.signal)) as ToolResult;
  }
};
