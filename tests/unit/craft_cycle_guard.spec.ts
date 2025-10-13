import { buildRecipeTree } from '../../action_tree/builders';
import { VariantConstraintManager, BuildContext } from '../../action_tree/types';
import { getCachedMcData } from '../testHelpers';

describe('unit: inventory-gated cycle guard', () => {
  const mcData = getCachedMcData('1.20.1');

  function makeContext(inv: Record<string, number> = {}): BuildContext {
    const inventory = new Map<string, number>();
    for (const [k, v] of Object.entries(inv)) inventory.set(k, v);
    return {
      inventory,
      pruneWithWorld: true,
      visited: new Set(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };
  }

  function treeHasCraftTo(itemName: string, target: string, tree: any): boolean {
    let found = false;
    (function walk(n: any) {
      if (!n || found) return;
      if (n.action === 'craft' && n.result?.variants?.some((v: any) => v.value.item === target)) {
        const ing = n.ingredients?.variants?.[0]?.value || [];
        if (ing.some((i: any) => i.item === itemName)) found = true;
      }
      (n.children?.variants || []).forEach((c: any) => walk(c.value));
    })(tree);
    return found;
  }

  test('disallows nugget -> ingot craft when no nuggets in inventory', () => {
    const ctx = makeContext({});
    const tree = buildRecipeTree(mcData, 'iron_ingot', 1, ctx);
    expect(treeHasCraftTo('iron_nugget', 'iron_ingot', tree)).toBe(false);
  });

  test('allows nugget -> ingot craft when nuggets are present', () => {
    const ctx = makeContext({ iron_nugget: 9 });
    const tree = buildRecipeTree(mcData, 'iron_ingot', 1, ctx);
    expect(treeHasCraftTo('iron_nugget', 'iron_ingot', tree)).toBe(true);
  });
});


