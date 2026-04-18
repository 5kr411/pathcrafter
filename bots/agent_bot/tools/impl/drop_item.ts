import type { ToolImpl } from '../types';

export const dropItemTool: ToolImpl = {
  schema: {
    name: 'drop_item',
    description: 'Drop items from the bot\'s inventory onto the ground at the bot\'s current location. If count is omitted, drops all matching items. Required to "give", "deliver", or "hand" items to a player — nothing else in this toolset transfers items from bot to player. To deliver at the player\'s feet: first goto_entity with the player\'s entity id (so the bot walks to them), THEN drop_item. Calling drop_item alone drops where the bot is standing, which may be far from the player.',
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
