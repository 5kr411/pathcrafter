import { buildRecipeTree } from '../../action_tree/builders';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';
import { getCachedMcData } from '../testHelpers';

/**
 * Tests for tool inventory check fix in dependencyInjector.ts
 * 
 * These tests verify that when a tool is already in inventory,
 * the system does NOT create a dependency subtree for crafting that tool.
 */

function countToolSubtrees(tree: any, toolName: string): number {
  if (!tree) return 0;
  
  let count = 0;
  
  // Check if this node is a root node for the tool
  if (tree.action === 'root' && 
      tree.what?.variants?.[0]?.value === toolName) {
    count++;
  }
  
  // Recurse through children
  if (tree.children?.variants) {
    for (const child of tree.children.variants) {
      count += countToolSubtrees(child.value, toolName);
    }
  }
  
  return count;
}

function hasToolCraftNode(tree: any, toolName: string): boolean {
  if (!tree) return false;
  
  // Check if this is a craft node for the tool
  if (tree.action === 'craft' &&
      tree.result?.variants?.[0]?.value?.item === toolName) {
    return true;
  }
  
  // Recurse through children
  if (tree.children?.variants) {
    for (const child of tree.children.variants) {
      if (hasToolCraftNode(child.value, toolName)) {
        return true;
      }
    }
  }
  
  return false;
}

describe('unit: tool inventory check', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.20.1');
  });

  describe('tool dependency with inventory', () => {
    test('wooden_pickaxe in inventory: no subtree for wooden_pickaxe when mining stone', () => {
      const inventory = new Map([['wooden_pickaxe', 1]]);
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
      
      // Should not have any subtrees for wooden_pickaxe
      const toolSubtreeCount = countToolSubtrees(tree, 'wooden_pickaxe');
      expect(toolSubtreeCount).toBe(0);
      
      // Should not have any craft nodes for wooden_pickaxe
      const hasCraft = hasToolCraftNode(tree, 'wooden_pickaxe');
      expect(hasCraft).toBe(false);
    });

    test('stone_pickaxe in inventory: no subtree for stone_pickaxe when mining iron', () => {
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

      const tree = buildRecipeTree(mcData, 'raw_iron', 3, context);
      
      const toolSubtreeCount = countToolSubtrees(tree, 'stone_pickaxe');
      expect(toolSubtreeCount).toBe(0);
      
      const hasCraft = hasToolCraftNode(tree, 'stone_pickaxe');
      expect(hasCraft).toBe(false);
    });

    test('iron_pickaxe in inventory: no subtree for iron_pickaxe when mining diamonds', () => {
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

      const tree = buildRecipeTree(mcData, 'diamond', 2, context);
      
      const toolSubtreeCount = countToolSubtrees(tree, 'iron_pickaxe');
      expect(toolSubtreeCount).toBe(0);
      
      const hasCraft = hasToolCraftNode(tree, 'iron_pickaxe');
      expect(hasCraft).toBe(false);
    });

    test('NO wooden_pickaxe in inventory: DOES create subtree for wooden_pickaxe', () => {
      const inventory = new Map(); // empty inventory
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
      
      // SHOULD have a subtree for wooden_pickaxe since it's not in inventory
      const toolSubtreeCount = countToolSubtrees(tree, 'wooden_pickaxe');
      expect(toolSubtreeCount).toBeGreaterThan(0);
      
      // SHOULD have craft nodes for wooden_pickaxe
      const hasCraft = hasToolCraftNode(tree, 'wooden_pickaxe');
      expect(hasCraft).toBe(true);
    });

    test('multiple tools in inventory: none are crafted', () => {
      const inventory = new Map([
        ['wooden_pickaxe', 1],
        ['stone_pickaxe', 1],
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

      const tree = buildRecipeTree(mcData, 'diamond', 3, context);
      
      // None of the tools should have subtrees
      expect(countToolSubtrees(tree, 'wooden_pickaxe')).toBe(0);
      expect(countToolSubtrees(tree, 'stone_pickaxe')).toBe(0);
      expect(countToolSubtrees(tree, 'iron_pickaxe')).toBe(0);
      
      expect(hasToolCraftNode(tree, 'wooden_pickaxe')).toBe(false);
      expect(hasToolCraftNode(tree, 'stone_pickaxe')).toBe(false);
      expect(hasToolCraftNode(tree, 'iron_pickaxe')).toBe(false);
    });
  });

  describe('comparison: workstation vs tool inventory check', () => {
    test('crafting_table in inventory: no subtree (existing behavior)', () => {
      const inventory = new Map([['crafting_table', 1]]);
      const context: Partial<BuildContext> = {
        inventory,
        visited: new Set<string>(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: new VariantConstraintManager(),
        combineSimilarNodes: true
      };

      const tree = buildRecipeTree(mcData, 'wooden_pickaxe', 1, context);
      
      const tableSubtreeCount = countToolSubtrees(tree, 'crafting_table');
      expect(tableSubtreeCount).toBe(0);
    });

    test('tool inventory check now matches workstation behavior', () => {
      // Tools should behave the same as workstations
      const toolInventory = new Map([['wooden_pickaxe', 1]]);
      const workstationInventory = new Map([['crafting_table', 1]]);
      
      const toolContext: Partial<BuildContext> = {
        inventory: toolInventory,
        visited: new Set<string>(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: new VariantConstraintManager(),
        combineSimilarNodes: true
      };

      const workstationContext: Partial<BuildContext> = {
        inventory: workstationInventory,
        visited: new Set<string>(),
        depth: 0,
        parentPath: [],
        config: { preferMinimalTools: true, maxDepth: 10 },
        variantConstraints: new VariantConstraintManager(),
        combineSimilarNodes: true
      };

      const treeWithTool = buildRecipeTree(mcData, 'cobblestone', 3, toolContext);
      const treeWithWorkstation = buildRecipeTree(mcData, 'wooden_pickaxe', 1, workstationContext);
      
      // Both should skip creating the dependency subtree
      expect(countToolSubtrees(treeWithTool, 'wooden_pickaxe')).toBe(0);
      expect(countToolSubtrees(treeWithWorkstation, 'crafting_table')).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('tool count > 1 in inventory: still skips subtree', () => {
      const inventory = new Map([['wooden_pickaxe', 5]]);
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

    test('wrong tool in inventory: correct tool IS crafted', () => {
      // Have stone_pickaxe but need iron_pickaxe for diamonds
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

      const tree = buildRecipeTree(mcData, 'diamond', 2, context);
      
      // Should NOT have stone_pickaxe subtree (already in inventory)
      expect(countToolSubtrees(tree, 'stone_pickaxe')).toBe(0);
      
      // SHOULD have iron_pickaxe subtree (needed but not in inventory)
      expect(countToolSubtrees(tree, 'iron_pickaxe')).toBeGreaterThan(0);
    });

    test('partial tool set in inventory: only missing tools are crafted', () => {
      // Have wooden and stone, but need iron for diamonds
      const inventory = new Map([
        ['wooden_pickaxe', 1],
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

      const tree = buildRecipeTree(mcData, 'diamond', 2, context);
      
      // Tools in inventory should not have subtrees
      expect(countToolSubtrees(tree, 'wooden_pickaxe')).toBe(0);
      expect(countToolSubtrees(tree, 'stone_pickaxe')).toBe(0);
      
      // Iron pickaxe needed but not in inventory - should have subtree
      expect(countToolSubtrees(tree, 'iron_pickaxe')).toBeGreaterThan(0);
    });
  });
});

