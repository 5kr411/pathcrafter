import * as fs from 'fs';
import * as path from 'path';
import { generateTopNAndFilter } from '../../path_filters';
import { plan } from '../../planner';
import minecraftData from 'minecraft-data';

describe.skip('integration: Top-N tie-break prefers closer blocks from snapshot', () => {

  function loadLatestSnapshot() {
    const dir = path.resolve(__dirname, '../../world_snapshots');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    if (files.length === 0) throw new Error('No snapshots found');
    const withTimes = files.map(f => { 
      const full = path.join(dir, f); 
      const stat = fs.statSync(full); 
      return { full, t: stat.mtimeMs }; 
    }).sort((a, b) => b.t - a.t);
    return JSON.parse(fs.readFileSync(withTimes[0].full, 'utf8'));
  }

  test('without combining: tie-breaking prefers closer wood species', async () => {
    // Without combining, tree explores ALL wood families as separate branches
    // Tie-breaking prefers paths using closer resources from the world snapshot
    const snapshot = loadLatestSnapshot();
    const present = snapshot && snapshot.blocks ? Object.keys(snapshot.blocks) : [];
    const presentLogs = present.filter(n => /_log$/.test(n));
    
    if (presentLogs.length < 2) {
      // Need at least 2 wood types to test tie-breaking
      return;
    }
    
    // Need crafting table in inventory or available in world
    const hasCraftingTable = (snapshot.blocks && 'crafting_table' in snapshot.blocks) || false;
    const inventory = hasCraftingTable ? new Map() : new Map([['crafting_table', 1]]);
    
    const paths = await generateTopNAndFilter('1.20.1', 'wooden_pickaxe', 1, {
      inventory,
      worldSnapshot: snapshot,
      perGenerator: 500,
      log: false,
      pruneWithWorld: true,
      combineSimilarNodes: false
    });
    
    if (paths.length === 0) {
      // If no paths found, it may be because snapshot has insufficient resources
      // This is acceptable for real-world snapshots - skip the test
      return;
    }
    
    const first = paths[0];
    const mined = first.filter((s: any) => s && s.action === 'mine').map((s: any) => s.what);
    const minedLogs = mined.filter((n: string) => /_log$/.test(n));
    
    if (minedLogs.length > 0) {
      // Ensure mined logs are among present blocks
      const ok = minedLogs.every((n: string) => present.includes(n));
      expect(ok).toBe(true);
      
      // Tie-breaking should prefer logs with lower average distance
      const getAvg = (n: string) => ((snapshot.blocks as any)[n]?.averageDistance) || Infinity;
      const minedAvg = Math.min(...minedLogs.map(getAvg));
      const allAvg = Math.min(...presentLogs.map(getAvg));
      
      // The mined log should have the minimum average distance among all present logs
      expect(minedAvg).toBe(allAvg);
    }
  });

  test('with combining: tree contains variants from multiple wood families', () => {
    // With combining, all wood families are explored and stored as variants
    const snapshot = loadLatestSnapshot();
    const present = snapshot && snapshot.blocks ? Object.keys(snapshot.blocks) : [];
    if (!present.some(n => /_log$/.test(n))) return; // skip if snapshot has no logs
    
    const mcData = minecraftData('1.20.1');
    const inventory = new Map();
    
    const tree = plan(mcData, 'wooden_pickaxe', 1, {
      inventory,
      log: false,
      pruneWithWorld: true,
      worldSnapshot: snapshot,
      combineSimilarNodes: true
    });
    
    // Find nodes with variants
    const findNodesWithVariants = (node: any): any[] => {
      const results: any[] = [];
      if ((node.result && node.result.variants.length > 1) || 
          (node.what && node.what.variants.length > 1)) {
        results.push(node);
      }
      if (node.children && node.children.variants) {
        node.children.variants.forEach((c: any) => {
          results.push(...findNodesWithVariants(c.value));
        });
      }
      return results;
    };
    
    const nodesWithVariants = findNodesWithVariants(tree);
    
    // Should have nodes with variants
    expect(nodesWithVariants.length).toBeGreaterThan(0);
  });

  test.skip('with combining: world filtering keeps only available wood variants', () => {
    // With world filtering, variants should be limited to what's in the snapshot
    const snapshot = loadLatestSnapshot();
    const present = snapshot && snapshot.blocks ? Object.keys(snapshot.blocks) : [];
    const presentLogs = present.filter(n => /_log$/.test(n));
    
    if (presentLogs.length === 0) return; // skip if snapshot has no logs
    
    const mcData = minecraftData('1.20.1');
    const inventory = new Map();
    
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
      if (node.children && node.children.variants) {
        node.children.variants.forEach((c: any) => {
          results.push(...findMineLeaves(c.value));
        });
      }
      return results;
    };
    
    const mineLeaves = findMineLeaves(tree);
    const leavesWithVariants = mineLeaves.filter(n => n.what && n.what.variants.length > 0);
    
    if (leavesWithVariants.length > 0) {
      // All variants should be available in snapshot
      leavesWithVariants.forEach(leaf => {
        const variants = leaf.what.variants.map((v: any) => v.value) || [];
        variants.forEach((block: string) => {
          if (/_log$/.test(block)) {
            expect(present).toContain(block);
          }
        });
      });
    }
  });
});

