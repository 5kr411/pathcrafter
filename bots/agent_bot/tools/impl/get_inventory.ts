import type { ToolImpl } from '../types';
import { getInventoryObject } from '../../../../utils/inventory';

export const getInventoryTool: ToolImpl = {
  schema: {
    name: 'get_inventory',
    description: 'Returns the bot\'s current inventory as a map of item name -> total count (including armor and offhand).',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  async execute(_input, ctx) {
    const inventory = getInventoryObject(ctx.bot);
    return { ok: true, data: { inventory } };
  }
};
