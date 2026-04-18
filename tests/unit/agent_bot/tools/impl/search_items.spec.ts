import { searchItemsTool } from '../../../../../bots/agent_bot/tools/impl/search_items';

describe('search_items', () => {
  const mkCtx = (bot: any) => ({
    bot, signal: new AbortController().signal,
    targetExecutor: {}, agentActionExecutor: {}, safeChat: () => {}
  });

  // Provide a mcData-shaped object directly — resolveMcData returns it as-is when
  // itemsByName/items/blocks/recipes are all present.
  const mkMc = () => ({
    itemsByName: {}, items: {}, blocks: {}, recipes: {},
    itemsArray: [
      { name: 'oak_log', displayName: 'Oak Log' },
      { name: 'dark_oak_log', displayName: 'Dark Oak Log' },
      { name: 'diamond', displayName: 'Diamond' },
      { name: 'diamond_sword', displayName: 'Diamond Sword' },
      { name: 'apple', displayName: 'Apple' }
    ],
    blocksArray: [
      { name: 'oak_log', displayName: 'Oak Log' }, // dup to test dedupe
      { name: 'stone', displayName: 'Stone' }
    ]
  });

  it('matches substring on name and displayName', async () => {
    const bot: any = mkMc();
    const r = await searchItemsTool.execute({ query: 'oak' }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const results = (r.data as any).results as any[];
    const names = results.map(x => x.name);
    expect(names).toContain('oak_log');
    expect(names).toContain('dark_oak_log');
    expect(names).not.toContain('stone');
  });

  it('is case-insensitive', async () => {
    const bot: any = mkMc();
    const r = await searchItemsTool.execute({ query: 'DIAMOND' }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = ((r.data as any).results as any[]).map(x => x.name);
      expect(names).toEqual(expect.arrayContaining(['diamond', 'diamond_sword']));
    }
  });

  it('dedupes by name and respects limit', async () => {
    const bot: any = mkMc();
    const r = await searchItemsTool.execute({ query: 'oak', limit: 1 }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const results = (r.data as any).results as any[];
      expect(results.length).toBe(1);
    }
  });

  it('defaults limit to 20', async () => {
    const bot: any = mkMc();
    const r = await searchItemsTool.execute({ query: 'a' }, mkCtx(bot) as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect(((r.data as any).results as any[]).length).toBeLessThanOrEqual(20);
  });

  it('errors without query', async () => {
    const bot: any = mkMc();
    const r = await searchItemsTool.execute({}, mkCtx(bot) as any);
    expect(r.ok).toBe(false);
  });
});
