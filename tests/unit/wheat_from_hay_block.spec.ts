/**
 * Tests for wheat from hay_block planning
 * 
 * Verifies the planner can find a path to wheat via mining hay_block,
 * even though there's a circular crafting dependency (wheat <-> hay_block).
 */

import { plan, _internals } from '../../planner';

const minecraftData = require('minecraft-data')('1.20.1');

describe('Wheat from hay_block planning', () => {
  it('should find a path to wheat when hay_block is in world snapshot', () => {
    const snapshot = {
      radius: 32,
      blocks: {
        hay_block: { count: 5, closestDistance: 10 }
      }
    };

    const tree = plan(minecraftData, 'wheat', 9, {
      inventory: new Map(),
      pruneWithWorld: true,
      combineSimilarNodes: false,
      worldSnapshot: snapshot as any
    });

    expect(tree).toBeDefined();
    expect(tree.children.variants.length).toBeGreaterThan(0);

    const { enumerateActionPathsGenerator } = _internals;
    let pathCount = 0;
    let foundMineHayBlock = false;
    
    for (const path of enumerateActionPathsGenerator(tree, { inventory: {} })) {
      pathCount++;
      const actions = path.map((s: any) => s.action);
      const items = path.map((s: any) => s.what?.variants?.[0]?.value || s.targetItem?.variants?.[0]?.value || '?');
      
      if (actions.includes('mine') && items.some((i: string) => i?.includes('hay_block'))) {
        foundMineHayBlock = true;
      }
      
      if (pathCount >= 10) break;
    }

    expect(pathCount).toBeGreaterThan(0);
    expect(foundMineHayBlock).toBe(true);
  });

  it('should find a path to wheat without world snapshot (no pruning)', () => {
    const tree = plan(minecraftData, 'wheat', 9, {
      inventory: new Map(),
      pruneWithWorld: false,
      combineSimilarNodes: false
    });

    expect(tree).toBeDefined();
    expect(tree.children.variants.length).toBeGreaterThan(0);

    const { enumerateActionPathsGenerator } = _internals;
    let pathCount = 0;
    
    for (const _path of enumerateActionPathsGenerator(tree, { inventory: {} })) {
      pathCount++;
      if (pathCount >= 5) break;
    }

    expect(pathCount).toBeGreaterThan(0);
  });

  it('should find a path to bread via wheat via hay_block', () => {
    const snapshot = {
      radius: 32,
      blocks: {
        hay_block: { count: 5, closestDistance: 10 },
        oak_log: { count: 10, closestDistance: 5 }  // Need logs for crafting table
      }
    };

    const tree = plan(minecraftData, 'bread', 3, {
      inventory: new Map(),
      pruneWithWorld: true,
      combineSimilarNodes: false,
      worldSnapshot: snapshot as any
    });

    expect(tree).toBeDefined();
    expect(tree.children.variants.length).toBeGreaterThan(0);

    const { enumerateActionPathsGenerator } = _internals;
    let foundPath = false;
    
    for (const _path of enumerateActionPathsGenerator(tree, { inventory: {} })) {
      foundPath = true;
      break;
    }

    expect(foundPath).toBe(true);
  });

  it('confirms hay_block <-> wheat circular dependency exists', () => {
    const wheatId = minecraftData.itemsByName['wheat'].id;
    const hayBlockId = minecraftData.itemsByName['hay_block'].id;

    // wheat recipe: hay_block -> wheat
    const wheatRecipes = minecraftData.recipes[wheatId] || [];
    const wheatFromHayBlock = wheatRecipes.some((r: any) => 
      r.ingredients?.includes(hayBlockId)
    );
    expect(wheatFromHayBlock).toBe(true);

    // hay_block recipe: wheat -> hay_block
    const hayBlockRecipes = minecraftData.recipes[hayBlockId] || [];
    const hayBlockFromWheat = hayBlockRecipes.some((r: any) =>
      r.ingredients?.includes(wheatId)
    );
    expect(hayBlockFromWheat).toBe(true);
  });

  it('confirms hay_block can be mined', () => {
    const hayBlock = minecraftData.blocksByName['hay_block'];
    expect(hayBlock).toBeDefined();
    
    // hay_block drops itself
    const hayBlockItemId = minecraftData.itemsByName['hay_block'].id;
    expect(hayBlock.drops).toContain(hayBlockItemId);
  });
});

