import type { ToolImpl } from '../types';

export const sendChatTool: ToolImpl = {
  schema: {
    name: 'send_chat',
    description: 'Send a chat message in the game. Useful for announcing intentions or responding to players.',
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
