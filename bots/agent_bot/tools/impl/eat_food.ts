import type { ToolImpl } from '../types';
import { eatFoodItem, findBestSafeFood, getFoodItems, type FoodItem } from './helpers/eat';

/**
 * Eat a food item synchronously. Runs inline (no AgentActionExecutor) because
 * eating does not pathfind — it's just equip + consume, which completes in
 * a handful of ticks. The reactive `food_eating_behavior` still handles
 * autonomous eating; this tool is for explicit LLM-initiated eats.
 */
export const eatFoodTool: ToolImpl = {
  schema: {
    name: 'eat_food',
    description: 'Eat a food item from inventory. If `item` is provided, eat that specific food; otherwise eat the best available safe food by saturation.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Optional specific food item name to eat.' }
      },
      required: []
    }
  },
  async execute(input, ctx) {
    const wanted = (input as any)?.item as string | undefined;
    const health = (ctx.bot as any)?.health ?? 20;
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
        foodAfter: (ctx.bot as any).food,
        saturationAfter: (ctx.bot as any).foodSaturation
      }
    };
  }
};
