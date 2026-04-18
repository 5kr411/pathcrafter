import { equipBestArmorTool } from '../../../../../bots/agent_bot/tools/impl/equip_best_armor';

describe('equip_best_armor', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  function makeBot(opts: { inventory: any[]; equipped?: Record<string, any> }) {
    const equipped = opts.equipped ?? {};
    const slotIndex: Record<string, number> = { head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45 };
    const slots = new Array(46).fill(null);
    for (const s of Object.keys(equipped)) {
      const i = slotIndex[s];
      if (i !== undefined) slots[i] = equipped[s];
    }
    const equipCalls: any[] = [];
    const bot: any = {
      inventory: { items: () => opts.inventory, slots },
      getEquipmentDestSlot: (s: string) => slotIndex[s],
      equip: async (item: any, slot: string) => { equipCalls.push([item.name, slot]); },
      unequip: async (_slot: string) => { /* noop */ }
    };
    bot._equipCalls = equipCalls;
    return bot;
  }

  it('equips best armor across all slots', async () => {
    const bot = makeBot({
      inventory: [
        { name: 'iron_helmet', type: 1 },
        { name: 'leather_helmet', type: 2 },
        { name: 'diamond_chestplate', type: 3 },
        { name: 'iron_leggings', type: 4 },
        { name: 'iron_boots', type: 5 }
      ]
    });
    const r = await equipBestArmorTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const eq = (r.data as any).equipped as string[];
    expect(eq).toContain('iron_helmet');
    expect(eq).toContain('diamond_chestplate');
    expect(eq).toContain('iron_leggings');
    expect(eq).toContain('iron_boots');
  });

  it('skips when no armor in inventory', async () => {
    const bot = makeBot({ inventory: [{ name: 'dirt', type: 7 }] });
    const r = await equipBestArmorTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).equipped).toEqual([]);
  });

  it('does not re-equip identical item already worn', async () => {
    const ironHelmet = { name: 'iron_helmet', type: 1 };
    const bot = makeBot({
      inventory: [ironHelmet],
      equipped: { head: ironHelmet }
    });
    const r = await equipBestArmorTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).equipped).toEqual([]);
  });
});
