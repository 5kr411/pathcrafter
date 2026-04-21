/**
 * Tests for mine node builder when the target is a SPECIFIC log variant.
 *
 * Regression test for: when a caller asks for `oak_log`, the planner must
 * not emit a mine node whose `what` variants include other wood-family
 * logs (e.g. spruce_log). Different logs drop different items — they are
 * not interchangeable for a specific-variant target.
 *
 * Before the fix: mineNodeBuilder fell back to `findSimilarItems` when
 * `findBlocksWithSameDrop` returned a single block, which pulled in every
 * `*_log` item as a "canonical variant" of oak_log, even though spruce_log
 * blocks drop spruce_log items (not oak_log).
 */

import { buildRecipeTree } from '../../action_tree/builders/treeOrchestrator';
import { enumerateActionPathsGenerator } from '../../path_generators/actionPathsGenerator';
import { WorldBudget } from '../../utils/worldBudget';
import { BuildContext, VariantConstraintManager } from '../../action_tree/types';
import { getCachedMcData } from '../testHelpers';

describe('Mine Node Builder - specific log variant target', () => {
  let mcData: any;

  beforeAll(() => {
    mcData = getCachedMcData('1.21.1');
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

  function findMineNodes(node: any): any[] {
    const results: any[] = [];
    if (!node) return results;
    if (node.action === 'mine' && !node.operator) {
      results.push(node);
    }
    if (node.children?.variants) {
      for (const child of node.children.variants) {
        results.push(...findMineNodes(child.value));
      }
    }
    return results;
  }

  test('oak_log target must NOT include spruce_log in mine node variants', () => {
    const worldBudget = createWorldBudget([
      ['oak_log', 50, 10],
      ['spruce_log', 1000, 3],
      ['birch_log', 500, 5]
    ]);

    const context: Partial<BuildContext> = {
      inventory: new Map(),
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true,
      worldBudget,
      pruneWithWorld: true
    };

    const tree = buildRecipeTree(mcData, 'oak_log', 10, context);
    const mineNodes = findMineNodes(tree);

    expect(mineNodes.length).toBeGreaterThan(0);

    for (const node of mineNodes) {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      expect(blocks).not.toContain('spruce_log');
      expect(blocks).not.toContain('birch_log');
      expect(blocks).not.toContain('jungle_log');
    }
  });

  test('oak_log target must NOT include spruce_log when spruce_log is the only available block', () => {
    const worldBudget = createWorldBudget([
      ['spruce_log', 1000, 3]
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

    const tree = buildRecipeTree(mcData, 'oak_log', 10, context);
    const mineNodes = findMineNodes(tree);

    for (const node of mineNodes) {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      expect(blocks).not.toContain('spruce_log');
    }
  });

  test('enumerated paths for oak_log must only reference oak_log blocks', () => {
    const worldBudget = createWorldBudget([
      ['oak_log', 50, 10],
      ['spruce_log', 1000, 3],
      ['birch_log', 500, 5]
    ]);

    const context: Partial<BuildContext> = {
      inventory: new Map(),
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true,
      worldBudget,
      pruneWithWorld: true
    };

    const tree = buildRecipeTree(mcData, 'oak_log', 10, context);

    const paths: any[] = [];
    const gen = enumerateActionPathsGenerator(tree, { inventory: new Map() });
    let count = 0;
    for (const path of gen) {
      paths.push(path);
      if (++count >= 20) break;
    }

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      for (const step of path) {
        if (step.action !== 'mine') continue;
        const blocks = step.what?.variants?.map((v: any) => v.value) || [];
        expect(blocks).not.toContain('spruce_log');
        expect(blocks).not.toContain('birch_log');
      }
    }
  });

  test('oak_log target with no world budget filter must not pull in spruce_log', () => {
    const context: Partial<BuildContext> = {
      inventory: new Map(),
      visited: new Set<string>(),
      depth: 0,
      parentPath: [],
      config: { preferMinimalTools: true, maxDepth: 10 },
      variantConstraints: new VariantConstraintManager(),
      combineSimilarNodes: true
    };

    const tree = buildRecipeTree(mcData, 'oak_log', 10, context);
    const mineNodes = findMineNodes(tree);

    expect(mineNodes.length).toBeGreaterThan(0);

    for (const node of mineNodes) {
      const blocks = node.what?.variants?.map((v: any) => v.value) || [];
      const otherLogs = blocks.filter((b: string) =>
        b.endsWith('_log') && !b.includes('oak')
      );
      expect(otherLogs).toEqual([]);
    }
  });
});
