/**
 * Tests for mine node builder when multiple target items are acceptable
 * 
 * This tests the fix for the bug where the bot would create separate mine nodes
 * for blocks that drop different items (stone->cobblestone, deepslate->cobbled_deepslate),
 * even when both items were valid for the same recipe (furnace).
 */

import { buildRecipeTree } from '../../action_tree/builders/treeOrchestrator';
import { WorldBudget } from '../../utils/worldBudget';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';
import { getCachedMcData } from '../testHelpers';

describe('Mine Node Builder - Multiple Target Items', () => {
  let mcData: any;

  beforeEach(() => {
    mcData = getCachedMcData('1.20.1');
  });

  function createWorldBudget(blockCounts: Array<[string, number, number]>): WorldBudget {
    const blocks: Record<string, number> = {};
    const blocksInfo: Record<string, { closestDistance: number }> = {};
    const allowedBlocks = new Set<string>();

    for (const [name, count, distance] of blockCounts) {
      blocks[name] = count;
      blocksInfo[name] = { closestDistance: distance };
      allowedBlocks.add(name);
    }

    return {
      blocks,
      blocksInfo,
      entities: {},
      entitiesInfo: {},
      distanceThreshold: 100,
      allowedBlocksWithinThreshold: allowedBlocks,
      allowedEntitiesWithinThreshold: new Set()
    };
  }

  test('should combine blocks with different drops when all drops are valid targets', () => {
    const worldBudget = createWorldBudget([
      ['stone', 1000, 5],
      ['deepslate', 500, 10],
      ['blackstone', 200, 15],
      ['oak_log', 100, 3]
    ]);

    const context: Partial<BuildContext> = {
      inventory: new Map(),
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true,
      worldBudget
    };

    const tree = buildRecipeTree(mcData, 'furnace', 1, context);

    const mineNodes: any[] = [];
    function findMineNodes(node: any): void {
      if (!node) return;
      if (node.action === 'mine') {
        mineNodes.push(node);
      }
      if (node.children?.variants) {
        for (const child of node.children.variants) {
          findMineNodes(child.value);
        }
      }
    }
    findMineNodes(tree);

    const furnaceIngredientNodes = mineNodes.filter(node => {
      const targetItems = node.targetItem?.variants?.map((v: any) => v.value) || [];
      return targetItems.includes('cobblestone') || targetItems.includes('cobbled_deepslate');
    });

    expect(furnaceIngredientNodes.length).toBeGreaterThan(0);

    const multiTargetNodes = furnaceIngredientNodes.filter(node => {
      const targetItems = node.targetItem?.variants?.map((v: any) => v.value) || [];
      return targetItems.length > 1 && 
             (targetItems.includes('cobblestone') && targetItems.includes('cobbled_deepslate'));
    });

    expect(multiTargetNodes.length).toBeGreaterThan(0);

    for (const node of multiTargetNodes) {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      expect(blocks.length).toBeGreaterThan(1);
      expect(node.variantMode).toBe('one_of');
    }
  });

  test('furnace recipe should create single mine node with stone and deepslate together', () => {
    const worldBudget = createWorldBudget([
      ['stone', 1000, 5],
      ['deepslate', 500, 10],
      ['oak_log', 100, 3]
    ]);

    const context: Partial<BuildContext> = {
      inventory: new Map(),
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true,
      worldBudget
    };

    const tree = buildRecipeTree(mcData, 'furnace', 1, context);

    const mineNodes: any[] = [];
    function findMineNodes(node: any): void {
      if (!node) return;
      if (node.action === 'mine') {
        mineNodes.push(node);
      }
      if (node.children?.variants) {
        for (const child of node.children.variants) {
          findMineNodes(child.value);
        }
      }
    }
    findMineNodes(tree);

    const stoneDeepslateNodes = mineNodes.filter(node => {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      return blocks.includes('stone') && blocks.includes('deepslate');
    });

    expect(stoneDeepslateNodes.length).toBeGreaterThan(0);

    const firstNode = stoneDeepslateNodes[0];
    const blocks = firstNode.what?.variants?.map((v: any) => v.value) || [];
    expect(blocks).toContain('stone');
    expect(blocks).toContain('deepslate');
    
    expect(firstNode.variantMode).toBe('one_of');
  });

  test('should not create separate mine nodes for stone and deepslate', () => {
    const worldBudget = createWorldBudget([
      ['stone', 1000, 5],
      ['deepslate', 500, 10],
      ['oak_log', 100, 3]
    ]);

    const context: Partial<BuildContext> = {
      inventory: new Map(),
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true,
      worldBudget
    };

    const tree = buildRecipeTree(mcData, 'furnace', 1, context);

    const mineNodes: any[] = [];
    function findMineNodes(node: any): void {
      if (!node) return;
      if (node.action === 'mine') {
        mineNodes.push(node);
      }
      if (node.children?.variants) {
        for (const child of node.children.variants) {
          findMineNodes(child.value);
        }
      }
    }
    findMineNodes(tree);

    const stoneOnlyNodes = mineNodes.filter(node => {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      const targetItems = node.targetItem?.variants?.map((v: any) => v.value) || [];
      const isForFurnace = targetItems.includes('cobblestone') || targetItems.includes('cobbled_deepslate');
      return isForFurnace && blocks.includes('stone') && !blocks.includes('deepslate');
    });

    const deepslateOnlyNodes = mineNodes.filter(node => {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      const targetItems = node.targetItem?.variants?.map((v: any) => v.value) || [];
      const isForFurnace = targetItems.includes('cobblestone') || targetItems.includes('cobbled_deepslate');
      return isForFurnace && blocks.includes('deepslate') && !blocks.includes('stone');
    });

    expect(stoneOnlyNodes.length).toBe(0);
    expect(deepslateOnlyNodes.length).toBe(0);
  });

  test('single target item should still combine blocks with same drop when combineSimilarNodes is enabled', () => {
    const worldBudget = createWorldBudget([
      ['iron_ore', 100, 10],
      ['deepslate_iron_ore', 50, 20],
      ['oak_log', 100, 3]
    ]);

    const context: Partial<BuildContext> = {
      inventory: new Map(),
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true,
      worldBudget
    };

    const tree = buildRecipeTree(mcData, 'raw_iron', 3, context);

    const mineNodes: any[] = [];
    function findMineNodes(node: any): void {
      if (!node) return;
      if (node.action === 'mine') {
        mineNodes.push(node);
      }
      if (node.children?.variants) {
        for (const child of node.children.variants) {
          findMineNodes(child.value);
        }
      }
    }
    findMineNodes(tree);

    const ironOreNodes = mineNodes.filter(node => {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      return blocks.includes('iron_ore') || blocks.includes('deepslate_iron_ore');
    });

    expect(ironOreNodes.length).toBeGreaterThan(0);

    for (const node of ironOreNodes) {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      expect(blocks).toContain('iron_ore');
      expect(blocks).toContain('deepslate_iron_ore');
    }
  });
});

