import { generateTopNAndFilter } from '../../path_filters';
import { plan } from '../../planner';
import minecraftData from 'minecraft-data';

describe('unit: Top-N tie-break by snapshot distance', () => {

  test('without combining: tie-breaking prefers closer wood species', async () => {
    // When combining is disabled, the tree explores ALL wood families as separate branches
    // These branches have equal weight but different distance scores based on world snapshot
    // The tie-breaking logic in generateTopN.ts prefers the path with lower distance
    
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, radius: 48, yMin: 0, yMax: 255,
      blocks: {
        spruce_log: { count: 10, closestDistance: 8, averageDistance: 12 },
        oak_log: { count: 10, closestDistance: 30, averageDistance: 45 }
      },
      entities: {}
    };
    const inventory = { crafting_table: 1 };
    const paths = await generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, {
      inventory,
      worldSnapshot: snapshot,
      perGenerator: 50,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: false
    });
    
    expect(paths.length).toBeGreaterThan(0);
    const first = paths[0];
    const minedBlocks = first.filter(s => s && s.action === 'mine').map(s => s.what);
    const logsInPath = minedBlocks.filter(n => /_log$/.test(n));
    
    // Should have at least one log being mined
    expect(logsInPath.length).toBeGreaterThan(0);
    
    // Should prefer spruce (closer) over oak
    const getAvg = (n: string) => ((snapshot.blocks as any)[n].averageDistance) || Infinity;
    const minedAvg = Math.min(...logsInPath.map(getAvg));
    expect(minedAvg).toBe(12); // spruce_log average
  });

  test('with combining: tree contains variants for multiple wood families', () => {
    // With combining, all wood families are explored and stored as variants
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, radius: 48, yMin: 0, yMax: 255,
      blocks: {
        spruce_log: { count: 10, closestDistance: 8, averageDistance: 12 },
        oak_log: { count: 10, closestDistance: 30, averageDistance: 45 }
      },
      entities: {}
    };
    const mcData = minecraftData('1.20.1');
    const inventory = { crafting_table: 1 };
    
    const tree = plan(mcData, 'wooden_pickaxe', 1, {
      inventory,
      log: false,
      pruneWithWorld: true,
      worldSnapshot: snapshot,
      combineSimilarNodes: true
    });
    
    // Find craft nodes with variants
    const findNodesWithVariants = (node: any): any[] => {
      const results: any[] = [];
      if (node.resultVariants || node.whatVariants) {
        results.push(node);
      }
      if (node.children) {
        node.children.forEach((c: any) => {
          results.push(...findNodesWithVariants(c));
        });
      }
      return results;
    };
    
    const nodesWithVariants = findNodesWithVariants(tree);
    
    // Should have nodes with variants
    expect(nodesWithVariants.length).toBeGreaterThan(0);
    
    // Check if any variants include different wood families
    const hasMultipleWoodFamilies = nodesWithVariants.some(node => {
      const variants = node.resultVariants || node.whatVariants || [];
      const woodTypes = new Set(variants.map((v: string) => v.split('_')[0])); // oak, spruce, etc.
      return woodTypes.size > 1;
    });
    
    expect(hasMultipleWoodFamilies).toBe(true);
  });

  test('with combining: world filtering removes unavailable wood variants', () => {
    // Test that world filtering removes variants not in the snapshot
    const snapshot = {
      version: '1.20.1', dimension: 'overworld', center: { x: 0, y: 64, z: 0 }, radius: 48, yMin: 0, yMax: 255,
      blocks: {
        spruce_log: { count: 10, closestDistance: 8, averageDistance: 12 }
        // Only spruce available, no oak
      },
      entities: {}
    };
    const mcData = minecraftData('1.20.1');
    const inventory = { crafting_table: 1 };
    
    const tree = plan(mcData, 'wooden_pickaxe', 1, {
      inventory,
      log: false,
      pruneWithWorld: true,
      worldSnapshot: snapshot,
      combineSimilarNodes: true
    });
    
    // Find mine leaf nodes with variants
    const findMineLeaves = (node: any): any[] => {
      const results: any[] = [];
      if (node.action === 'mine' && node.what && !node.children?.length) {
        results.push(node);
      }
      if (node.children) {
        node.children.forEach((c: any) => {
          results.push(...findMineLeaves(c));
        });
      }
      return results;
    };
    
    const mineLeaves = findMineLeaves(tree);
    const leavesWithVariants = mineLeaves.filter(n => n.whatVariants && n.whatVariants.length > 0);
    
    if (leavesWithVariants.length > 0) {
      // If there are variants after filtering, they should all be available in snapshot
      leavesWithVariants.forEach(leaf => {
        const variants = leaf.whatVariants || [];
        variants.forEach((block: string) => {
          if (/_log$/.test(block)) {
            expect(snapshot.blocks).toHaveProperty(block);
          }
        });
      });
    }
  });
});

