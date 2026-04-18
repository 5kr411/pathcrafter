import type { ToolImpl } from '../types';

export const dropItemTool: ToolImpl = {
  schema: {
    name: 'drop_item',
    description: 'Drop a number of items (by item name) from the bot\'s inventory. If count is omitted, drops all matching items.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string' },
        count: { type: 'number', minimum: 1 }
      },
      required: ['item']
    }
  },
  async execute(input, ctx) {
    const item = (input as any)?.item;
    if (typeof item !== 'string' || !item) {
      return { ok: false, error: 'item name is required' };
    }

    const items = ctx.bot?.inventory?.items?.() ?? [];
    const matching = items.filter((i: any) => i && i.name === item);
    if (matching.length === 0) {
      return { ok: false, error: `${item} not in inventory` };
    }

    const totalAvailable = matching.reduce((sum: number, it: any) => sum + (it.count ?? 0), 0);
    const requestedRaw = (input as any)?.count;
    const count = typeof requestedRaw === 'number' ? Math.min(requestedRaw, totalAvailable) : totalAvailable;
    if (count <= 0) return { ok: false, error: 'count must be > 0' };

    const itemType = matching[0].type;
    await ctx.bot.toss(itemType, null, count);
    return { ok: true, data: { dropped: count, item } };
  }
};
