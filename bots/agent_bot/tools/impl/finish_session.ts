import type { ToolImpl } from '../types';
import logger from '../../../../utils/logger';

type FinishSessionInput = { reason: string };

export const finishSessionTool: ToolImpl<FinishSessionInput> = {
  schema: {
    name: 'finish_session',
    description: 'Signal that you have nothing left to do. Call this ONLY when EITHER (a) the player gave you a specific finite goal (e.g. "collect 64 logs", "reach the village", "kill 5 zombies") AND you have fully achieved it, OR (b) the player explicitly told you to stop, wait, idle, or sleep. After calling this, the host stops nudging you until a player addresses you in chat or you die and respawn. NEVER call this for open-ended directives like "progress as far as possible", "play", "explore", "make progress", or anything without a measurable finish line — those have no completion condition, so the correct response when you do not know the next step is to pick a reasonable next milestone (better tools, more food, exploration, mining higher-tier ore, etc.) and issue collect_item or another action tool. Reaching a "starter kit" or "basic setup" is NOT completion of an open-ended goal — it is one step. Calling this prematurely will leave you standing idle indefinitely.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief explanation of what you accomplished and why you consider yourself done.'
        }
      },
      required: ['reason']
    }
  },
  async execute(input, ctx) {
    const reason = input?.reason;
    if (typeof reason !== 'string' || reason.length === 0) {
      return { ok: false, error: 'reason must be a non-empty string' };
    }
    logger.info(`AgentBot: finish_session called: ${reason}`);
    ctx.safeChat(`[done] ${reason}`);
    ctx.onFinishSession(reason);
    return {
      ok: true,
      data: {
        acknowledged: true,
        note: 'The session is now idle. End your turn without further tool calls.'
      }
    };
  }
};
