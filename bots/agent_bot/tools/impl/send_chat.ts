import type { ToolImpl } from '../types';

export const sendChatTool: ToolImpl = {
  schema: {
    name: 'send_chat',
    description: 'Send an intermediate chat message to the player while work is in progress — e.g. "on it, getting logs", "found 40/64", "crafting the pickaxe now". Use this for goal acknowledgement and mid-task milestone updates on long-running operations so the player knows you heard them and what you\'re doing. Do NOT use this for the final reply at end-of-goal — that is the assistant\'s text message, emitted by returning text without any tool calls.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message']
    }
  },
  async execute(input, ctx) {
    const message = (input as any)?.message;
    if (typeof message !== 'string' || message.length === 0) {
      return { ok: false, error: 'message must be a non-empty string' };
    }
    if (typeof ctx.safeChat === 'function') {
      ctx.safeChat(message);
    } else if (typeof ctx.bot?.chat === 'function') {
      ctx.bot.chat(message);
    } else {
      return { ok: false, error: 'no chat function available' };
    }
    return { ok: true };
  }
};
