import type { ToolImpl } from '../types';

export const getHealthTool: ToolImpl = {
  schema: {
    name: 'get_health',
    description: 'Returns current health (0-20), food (0-20), and saturation values.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  async execute(_input, ctx) {
    return {
      ok: true,
      data: {
        health: ctx.bot?.health,
        food: ctx.bot?.food,
        saturation: ctx.bot?.foodSaturation
      }
    };
  }
};
