import type { ToolImpl } from '../types';

export const getPositionTool: ToolImpl = {
  schema: {
    name: 'get_position',
    description: 'Returns the bot\'s current position (x, y, z) and dimension.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  async execute(_input, ctx) {
    const pos = ctx.bot?.entity?.position;
    if (!pos) return { ok: false, error: 'bot.entity.position unavailable' };
    const dimension = ctx.bot?.game?.dimension;
    return { ok: true, data: { x: pos.x, y: pos.y, z: pos.z, dimension } };
  }
};
