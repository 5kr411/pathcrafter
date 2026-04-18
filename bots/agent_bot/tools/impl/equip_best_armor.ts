import type { ToolImpl } from '../types';
import { equipBestArmor } from './helpers/armor';

export const equipBestArmorTool: ToolImpl = {
  schema: {
    name: 'equip_best_armor',
    description: 'Equip the best available armor for each slot (head, torso, legs, feet) from the bot\'s inventory. Returns the names of items equipped.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  async execute(_input, ctx) {
    try {
      const equipped = await equipBestArmor(ctx.bot);
      return { ok: true, data: { equipped } };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }
};
