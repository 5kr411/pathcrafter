import { hasEqualOrBetterTool, rank, getSuffixTokenFromName } from '../../utils/items';
import { buildRecipeTree } from '../../action_tree/builders';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';
import { getCachedMcData } from '../testHelpers';

/**
 * Unit tests for "equal or better tool" detection
 * 
 * These tests verify that the system correctly identifies when a bot
 * already has a tool that can substitute for a required tool.
 */

describe('unit: better tool detection', () => {
  describe('rank function', () => {
    test('ranks tools in correct tier order', () => {
      expect(rank('wooden_pickaxe')).toBe(0);
      expect(rank('golden_pickaxe')).toBe(0.5);
      expect(rank('stone_pickaxe')).toBe(1);
      expect(rank('iron_pickaxe')).toBe(2);
      expect(rank('diamond_pickaxe')).toBe(3);
      expect(rank('netherite_pickaxe')).toBe(4);
    });

    test('works for all tool types', () => {
      expect(rank('wooden_axe')).toBe(0);
      expect(rank('stone_shovel')).toBe(1);
      expect(rank('iron_sword')).toBe(2);
      expect(rank('diamond_hoe')).toBe(3);
    });

    test('returns 10 for unknown materials', () => {
      expect(rank('obsidian_pickaxe')).toBe(10);
      expect(rank('coal')).toBe(10);
    });
  });

  describe('getSuffixTokenFromName', () => {
    test('extracts tool type correctly', () => {
      expect(getSuffixTokenFromName('wooden_pickaxe')).toBe('pickaxe');
      expect(getSuffixTokenFromName('diamond_axe')).toBe('axe');
      expect(getSuffixTokenFromName('iron_shovel')).toBe('shovel');
      expect(getSuffixTokenFromName('stone_sword')).toBe('sword');
    });

    test('handles items without underscores', () => {
      expect(getSuffixTokenFromName('coal')).toBe('coal');
      expect(getSuffixTokenFromName('stick')).toBe('stick');
    });
  });

  describe('hasEqualOrBetterTool', () => {
    describe('exact tool match', () => {
      test('returns true when exact tool is in inventory', () => {
        const inv = new Map([['wooden_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(true);
      });

      test('returns true with multiple of the same tool', () => {
        const inv = new Map([['stone_pickaxe', 5]]);
        expect(hasEqualOrBetterTool(inv, 'stone_pickaxe')).toBe(true);
      });
    });

    describe('better tool available', () => {
      test('diamond_pickaxe satisfies wooden_pickaxe requirement', () => {
        const inv = new Map([['diamond_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(true);
      });

      test('iron_pickaxe satisfies wooden_pickaxe requirement', () => {
        const inv = new Map([['iron_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(true);
      });

      test('stone_pickaxe satisfies wooden_pickaxe requirement', () => {
        const inv = new Map([['stone_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(true);
      });

      test('netherite_pickaxe satisfies iron_pickaxe requirement', () => {
        const inv = new Map([['netherite_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'iron_pickaxe')).toBe(true);
      });

      test('diamond_axe satisfies stone_axe requirement', () => {
        const inv = new Map([['diamond_axe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'stone_axe')).toBe(true);
      });
    });

    describe('worse tool does NOT satisfy', () => {
      test('wooden_pickaxe does NOT satisfy iron_pickaxe requirement', () => {
        const inv = new Map([['wooden_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'iron_pickaxe')).toBe(false);
      });

      test('stone_pickaxe does NOT satisfy diamond_pickaxe requirement', () => {
        const inv = new Map([['stone_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'diamond_pickaxe')).toBe(false);
      });

      test('iron_pickaxe does NOT satisfy netherite_pickaxe requirement', () => {
        const inv = new Map([['iron_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'netherite_pickaxe')).toBe(false);
      });
    });

    describe('wrong tool type', () => {
      test('diamond_axe does NOT satisfy wooden_pickaxe requirement', () => {
        const inv = new Map([['diamond_axe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(false);
      });

      test('iron_pickaxe does NOT satisfy iron_axe requirement', () => {
        const inv = new Map([['iron_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'iron_axe')).toBe(false);
      });

      test('stone_shovel does NOT satisfy stone_sword requirement', () => {
        const inv = new Map([['stone_shovel', 1]]);
        expect(hasEqualOrBetterTool(inv, 'stone_sword')).toBe(false);
      });
    });

    describe('edge cases', () => {
      test('empty inventory returns false', () => {
        const inv = new Map();
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(false);
      });

      test('undefined inventory returns false', () => {
        expect(hasEqualOrBetterTool(undefined, 'wooden_pickaxe')).toBe(false);
      });

      test('tool with count=0 does not satisfy', () => {
        const inv = new Map([['diamond_pickaxe', 0]]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(false);
      });

      test('multiple different tools: finds the right one', () => {
        const inv = new Map([
          ['wooden_axe', 1],
          ['stone_shovel', 1],
          ['diamond_pickaxe', 1],
          ['iron_sword', 1]
        ]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(true);
        expect(hasEqualOrBetterTool(inv, 'iron_axe')).toBe(false);
        expect(hasEqualOrBetterTool(inv, 'stone_shovel')).toBe(true);
      });
    });

    describe('golden tier edge case', () => {
      test('golden_pickaxe satisfies wooden_pickaxe (rank 0.5 >= 0)', () => {
        const inv = new Map([['golden_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'wooden_pickaxe')).toBe(true);
      });

      test('stone_pickaxe satisfies golden_pickaxe (rank 1 >= 0.5)', () => {
        const inv = new Map([['stone_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'golden_pickaxe')).toBe(true);
      });

      test('wooden_pickaxe does NOT satisfy golden_pickaxe (rank 0 < 0.5)', () => {
        const inv = new Map([['wooden_pickaxe', 1]]);
        expect(hasEqualOrBetterTool(inv, 'golden_pickaxe')).toBe(false);
      });
    });
  });

  describe('integration with buildRecipeTree', () => {
    let mcData: any;

    beforeAll(() => {
      mcData = getCachedMcData('1.20.1');
    });

    function countToolSubtrees(tree: any, toolName: string): number {
      if (!tree) return 0;
      
      let count = 0;
      
      if (tree.action === 'root' && 
          tree.what?.variants?.[0]?.value === toolName) {
        count++;
      }
      
      if (tree.children?.variants) {
        for (const child of tree.children.variants) {
          count += countToolSubtrees(child.value, toolName);
        }
      }
      
      return count;
    }

    test('diamond_pickaxe in inventory: no wooden_pickaxe subtree for cobblestone', () => {
      const inventory = new Map([['diamond_pickaxe', 1]]);
      const context: Partial<BuildContext> = {
        inventory,
        visited: new Set<string>(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: new VariantConstraintManager(),
        combineSimilarNodes: true
      };

      const tree = buildRecipeTree(mcData, 'cobblestone', 3, context);
      
      expect(countToolSubtrees(tree, 'wooden_pickaxe')).toBe(0);
    });

    test('iron_pickaxe in inventory: no wooden or stone pickaxe subtrees for raw_iron', () => {
      const inventory = new Map([
        ['iron_pickaxe', 1],
        ['crafting_table', 1]
      ]);
      const context: Partial<BuildContext> = {
        inventory,
        visited: new Set<string>(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: new VariantConstraintManager(),
        combineSimilarNodes: true
      };

      const tree = buildRecipeTree(mcData, 'raw_iron', 3, context);
      
      expect(countToolSubtrees(tree, 'wooden_pickaxe')).toBe(0);
      expect(countToolSubtrees(tree, 'stone_pickaxe')).toBe(0);
    });

    test('stone_pickaxe in inventory: no wooden_pickaxe subtree but YES for iron tools', () => {
      const inventory = new Map([
        ['stone_pickaxe', 1],
        ['crafting_table', 1]
      ]);
      const context: Partial<BuildContext> = {
        inventory,
        visited: new Set<string>(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: new VariantConstraintManager(),
        combineSimilarNodes: true
      };

      const cobbleTree = buildRecipeTree(mcData, 'cobblestone', 3, context);
      expect(countToolSubtrees(cobbleTree, 'wooden_pickaxe')).toBe(0);
      
      const diamondTree = buildRecipeTree(mcData, 'diamond', 2, context);
      expect(countToolSubtrees(diamondTree, 'iron_pickaxe')).toBeGreaterThan(0);
    });
  });
});

