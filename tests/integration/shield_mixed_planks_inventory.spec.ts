/**
 * Reproduces the shield crafting failure from e2e run 2026-03-21_11-49-22_b2861c.
 *
 * Shield requires 6 planks of the SAME wood type + 1 iron_ingot.
 * When the bot has planks split across variants (e.g. 4 dark_oak + 4 birch),
 * the planner's deductFromInventory sums across variants and concludes
 * "has 8 planks, needs 6, already satisfied" — but at craft time no single
 * variant has ≥6, so mineflayer's bot.recipesFor() returns nothing.
 *
 * The planner must NOT credit mixed-variant planks as if they're fungible
 * for a recipe that requires a single variant.
 */

import { plan } from '../../planner';
import minecraftData from 'minecraft-data';

describe('shield with mixed planks in inventory', () => {
  const mcData = minecraftData('1.20.1');

  /**
   * Helper: walk the tree and find the planks ingredient subtree under a
   * shield craft node.  Returns the subtree's `count` — the number of
   * additional planks the planner thinks it needs to acquire.
   */
  function findPlanksSubtreeCount(node: any): number | null {
    if (!node) return null;

    // Look for craft nodes whose result includes "shield"
    if (node.action === 'craft' && node.result?.variants) {
      const isShieldCraft = node.result.variants.some(
        (v: any) => v.value?.item === 'shield'
      );
      if (isShieldCraft && node.children?.variants) {
        // Among the children, find the planks ingredient subtree
        for (const child of node.children.variants) {
          const sub = child.value;
          if (sub?.action === 'root' && sub.what?.variants) {
            const isPlanksSub = sub.what.variants.some(
              (v: any) => typeof v.value === 'string' && v.value.endsWith('_planks')
            );
            if (isPlanksSub) {
              return sub.count;
            }
          }
        }
      }
    }

    // Recurse into children
    if (node.children?.variants) {
      for (const child of node.children.variants) {
        const result = findPlanksSubtreeCount(child.value);
        if (result !== null) return result;
      }
    }
    return null;
  }

  test('planner must not treat 4 dark_oak_planks + 4 birch_planks as 8 usable planks for shield', () => {
    // Exact scenario from e2e: bot has 4+4 mixed planks, 1 iron_ingot, crafting table
    const inventory = new Map<string, number>([
      ['dark_oak_planks', 4],
      ['birch_planks', 4],
      ['iron_ingot', 1],
      ['crafting_table', 1],
      ['stick', 28],
      ['cobblestone', 100],
    ]);

    const tree = plan(mcData, 'shield', 1, {
      inventory,
      combineSimilarNodes: true,
      log: false,
    });

    // The tree must include a way to acquire more planks.
    // If the planner correctly recognises that no single variant has ≥6,
    // the planks subtree count should be > 0 (needs at least 2 more).
    //
    // BUG (current): deductFromInventory sums 4+4=8, deducts 6, returns 0.
    // The planks subtree has count=0 so no log-mining children are generated.
    // At runtime, craft fails with "No recipe found for shield".
    const planksNeeded = findPlanksSubtreeCount(tree);

    // planksNeeded should be > 0 (the planner must plan to acquire more planks)
    // OR planksNeeded should be null if the tree structure differs —
    // but the generated paths must include a step to obtain planks.
    expect(planksNeeded).not.toBe(0);
  });

  test('planner correctly credits 8 planks of a SINGLE type for shield', () => {
    // Control case: 8 dark_oak_planks (all same type) — should work fine
    const inventory = new Map<string, number>([
      ['dark_oak_planks', 8],
      ['iron_ingot', 1],
      ['crafting_table', 1],
    ]);

    const tree = plan(mcData, 'shield', 1, {
      inventory,
      combineSimilarNodes: true,
      log: false,
    });

    // With 8 of one type, the planner should see this as satisfied
    const planksNeeded = findPlanksSubtreeCount(tree);

    // Either count is 0 (satisfied) or subtree is absent (already have enough)
    expect(planksNeeded === 0 || planksNeeded === null).toBe(true);
  });

  test('exact bot inventory from e2e abot_5_d0a9: shield plan should require more planks', () => {
    // Reproduced from bot abot_5_d0a9 logs at the moment shield crafting failed
    const inventory = new Map<string, number>([
      ['birch_planks', 4],
      ['dark_oak_planks', 4],
      ['iron_ingot', 1],
      ['coal', 3],
      ['stick', 29],
      ['cobblestone', 163],
      ['crafting_table', 7],
      ['furnace', 1],
      ['iron_pickaxe', 1],
      ['stone_pickaxe', 1],
      ['wooden_pickaxe', 1],
      ['wooden_axe', 1],
    ]);

    const tree = plan(mcData, 'shield', 1, {
      inventory,
      combineSimilarNodes: true,
      log: false,
    });

    // The tree MUST have children that acquire planks — the mixed inventory
    // should not be treated as sufficient
    expect(tree.children.variants.length).toBeGreaterThan(0);

    const planksNeeded = findPlanksSubtreeCount(tree);
    expect(planksNeeded).not.toBe(0);
  });
});
