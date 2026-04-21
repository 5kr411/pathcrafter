import type { ToolImpl } from '../types';
import { eatFoodItem, findBestSafeFood, getFoodItems, type FoodItem } from './helpers/eat';

type EatFoodInput = { item?: string };

/**
 * Eat a food item synchronously. Runs inline (no AgentActionExecutor) because
 * eating does not pathfind — it's just equip + consume, which completes in
 * a handful of ticks. The reactive `food_eating_behavior` still handles
 * autonomous eating; this tool is for explicit LLM-initiated eats.
 */
export const eatFoodTool: ToolImpl<EatFoodInput> = {
  schema: {
    name: 'eat_food',
    description: 'Explicitly eat a food item from inventory. You rarely need this — the reactive safety layer eats automatically when hunger drops. Use only when the player explicitly asks you to eat, or when you need to top off saturation before a known-strenuous task. If `item` is provided, eat that specific food; otherwise pick the best available safe food.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Optional specific food item name to eat.' }
      },
      required: []
    }
  },
  async execute(input, ctx) {
    const wanted = input?.item;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    const health = (ctx.bot as any)?.health ?? 20;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
    const foodLevel = (ctx.bot as any)?.food ?? 20;

    if (foodLevel >= 20 && health >= 20) {
      return { ok: false, error: 'already full' };
    }

    let food: FoodItem | null = null;
    if (typeof wanted === 'string' && wanted.length > 0) {
      const all = getFoodItems(ctx.bot);
      food = all.find(f => f.item.name === wanted) ?? null;
      if (!food) {
        return { ok: false, error: `no food: ${wanted}` };
      }
    } else {
      food = findBestSafeFood(ctx.bot);
      if (!food) {
        return { ok: false, error: 'no food' };
      }
    }

    const ok = await eatFoodItem(ctx.bot, food);
    if (!ok) {
      return { ok: false, error: 'eat failed' };
    }

    return {
      ok: true,
      data: {
        ate: food.item.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
        foodAfter: (ctx.bot as any).food,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mineflayer plugin lacks types
        saturationAfter: (ctx.bot as any).foodSaturation
      }
    };
  }
};
