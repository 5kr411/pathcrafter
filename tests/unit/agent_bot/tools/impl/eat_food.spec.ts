import { eatFoodTool } from '../../../../../bots/agent_bot/tools/impl/eat_food';

/**
 * Make a fake bot with enough surface to satisfy the eat helpers:
 *  - `bot.version` → minecraft-data foods map
 *  - `bot.inventory.items()` → list of {name, count, ...}
 *  - `bot.equip(item, 'hand')` → sets `bot.heldItem`
 *  - `bot.consume()` → bumps `bot.food`
 */
function makeBot(opts: {
  items?: Array<{ name: string; count?: number }>;
  food?: number;
  health?: number;
} = {}): any {
  const items = (opts.items ?? []).map(i => ({ name: i.name, count: i.count ?? 1 }));
  const bot: any = {
    version: '1.20.1',
    food: opts.food ?? 10,
    health: opts.health ?? 20,
    heldItem: null,
    inventory: {
      items: () => items
    }
  };
  bot.equip = jest.fn(async (item: any, _dest: string) => {
    bot.heldItem = item;
  });
  bot.consume = jest.fn(async () => {
    // Pretend each consume bumps food by 4.
    bot.food = Math.min(20, (bot.food ?? 0) + 4);
  });
  bot.deactivateItem = jest.fn();
  return bot;
}

function makeCtx(bot: any): any {
  return {
    bot,
    signal: new AbortController().signal,
    targetExecutor: {},
    agentActionExecutor: { run: jest.fn() },
    safeChat: () => {}
  };
}

describe('eat_food tool', () => {
  it('eats the best safe food by default', async () => {
    const bot = makeBot({ items: [{ name: 'bread' }, { name: 'cooked_beef' }], food: 10 });
    const ctx = makeCtx(bot);
    const r = await eatFoodTool.execute({}, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as any).ate).toBeDefined();
      // cooked_beef has higher saturation than bread → preferred.
      expect((r.data as any).ate).toBe('cooked_beef');
    }
    expect(bot.equip).toHaveBeenCalled();
    expect(bot.consume).toHaveBeenCalled();
  });

  it('eats a specific item when `item` provided', async () => {
    const bot = makeBot({ items: [{ name: 'bread' }, { name: 'cooked_beef' }], food: 10 });
    const ctx = makeCtx(bot);
    const r = await eatFoodTool.execute({ item: 'bread' }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).ate).toBe('bread');
  });

  it('fails with "already full" when food=20 and health=20', async () => {
    const bot = makeBot({ items: [{ name: 'bread' }], food: 20, health: 20 });
    const ctx = makeCtx(bot);
    const r = await eatFoodTool.execute({}, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('already full');
  });

  it('fails with "no food" when inventory has no food', async () => {
    const bot = makeBot({ items: [{ name: 'oak_log' }], food: 10 });
    const ctx = makeCtx(bot);
    const r = await eatFoodTool.execute({}, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no food');
  });

  it('fails when specific item not found', async () => {
    const bot = makeBot({ items: [{ name: 'bread' }], food: 10 });
    const ctx = makeCtx(bot);
    const r = await eatFoodTool.execute({ item: 'golden_apple' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no food');
  });

  it('returns eat failed when consume throws', async () => {
    const bot = makeBot({ items: [{ name: 'bread' }], food: 10 });
    bot.consume = jest.fn().mockRejectedValue(new Error('boom'));
    const ctx = makeCtx(bot);
    const r = await eatFoodTool.execute({}, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('eat failed');
  });
});
