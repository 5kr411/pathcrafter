import { generateTopNAndFilter } from '../../path_filters';
import { ActionStep } from '../../action_tree/types';

function countMiningSteps(path: ActionStep[], blockName: string): { totalCount: number; stepCount: number } {
  let totalCount = 0;
  let stepCount = 0;
  
  for (const step of path) {
    if (step.action === 'mine') {
      const what = step.what?.variants?.[0]?.value;
      if (what && what.includes(blockName)) {
        totalCount += step.count || 0;
        stepCount++;
      }
    }
  }
  
  return { totalCount, stepCount };
}

function hasCraft(path: ActionStep[], itemName: string): boolean {
  return path.some(step => 
    step.action === 'craft' && 
    step.result?.variants?.[0]?.value?.item === itemName
  );
}

describe('integration: diamond_pickaxe mining counts', () => {
  test('should mine only required logs for diamond_pickaxe from scratch', async () => {
    const inventory = new Map<string, number>();
    
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 4,
      radius: 64,
      yMin: -64,
      yMax: 320,
      blocks: {
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        diamond_ore: { count: 10, closestDistance: 30, averageDistance: 40 },
        deepslate_diamond_ore: { count: 15, closestDistance: 35, averageDistance: 45 },
        iron_ore: { count: 50, closestDistance: 20, averageDistance: 30 },
        stone: { count: 1000, closestDistance: 2, averageDistance: 10 },
        cobblestone: { count: 500, closestDistance: 2, averageDistance: 8 },
        coal_ore: { count: 100, closestDistance: 10, averageDistance: 20 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'diamond_pickaxe',
      1,
      { 
        inventory, 
        perGenerator: 50, 
        log: false, 
        worldSnapshot, 
        pruneWithWorld: true 
      }
    );

    expect(paths.length).toBeGreaterThan(0);
    
    const firstPath = paths[0];
    
    expect(hasCraft(firstPath, 'diamond_pickaxe')).toBe(true);
    
    const logMining = countMiningSteps(firstPath, '_log');
    
    expect(logMining.stepCount).toBeLessThanOrEqual(1);
    
    expect(logMining.totalCount).toBeLessThanOrEqual(6);
    expect(logMining.totalCount).toBeGreaterThanOrEqual(1);
  });

  test('should mine only required logs when starting with some tools', async () => {
    const inventory = new Map<string, number>([
      ['stone_pickaxe', 1],
      ['crafting_table', 1]
    ]);
    
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 3,
      radius: 48,
      yMin: -64,
      yMax: 320,
      blocks: {
        oak_log: { count: 50, closestDistance: 5, averageDistance: 10 },
        diamond_ore: { count: 8, closestDistance: 30, averageDistance: 40 },
        iron_ore: { count: 40, closestDistance: 15, averageDistance: 25 },
        coal_ore: { count: 80, closestDistance: 10, averageDistance: 20 },
        cobblestone: { count: 300, closestDistance: 3, averageDistance: 8 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'diamond_pickaxe',
      1,
      { 
        inventory, 
        perGenerator: 50, 
        log: false, 
        worldSnapshot, 
        pruneWithWorld: true 
      }
    );

    expect(paths.length).toBeGreaterThan(0);
    
    const firstPath = paths[0];
    const logMining = countMiningSteps(firstPath, '_log');
    
    if (logMining.stepCount > 0) {
      expect(logMining.stepCount).toBe(1);
      expect(logMining.totalCount).toBeLessThanOrEqual(3);
    }
  });

  test('should not have orphaned ingredient steps after persistent item deduplication', async () => {
    const inventory = new Map<string, number>();
    
    const worldSnapshot = {
      version: '1.20.1',
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      chunkRadius: 2,
      radius: 32,
      yMin: -64,
      yMax: 320,
      blocks: {
        oak_log: { count: 100, closestDistance: 5, averageDistance: 10 },
        diamond_ore: { count: 10, closestDistance: 30, averageDistance: 40 },
        iron_ore: { count: 50, closestDistance: 20, averageDistance: 30 },
        stone: { count: 500, closestDistance: 2, averageDistance: 8 },
        coal_ore: { count: 100, closestDistance: 10, averageDistance: 20 }
      },
      entities: {}
    };

    const paths = await generateTopNAndFilter(
      '1.20.1',
      'diamond_pickaxe',
      1,
      { 
        inventory, 
        perGenerator: 30, 
        log: false, 
        worldSnapshot, 
        pruneWithWorld: true 
      }
    );

    expect(paths.length).toBeGreaterThan(0);
    
    const firstPath = paths[0];
    
    const persistentTools = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe'];
    for (const tool of persistentTools) {
      const toolCrafts = firstPath.filter(s => 
        s.action === 'craft' && 
        s.result?.variants?.[0]?.value?.item === tool
      );
      
      if (toolCrafts.length > 0) {
        expect(toolCrafts.length).toBe(1);
        expect(toolCrafts[0].count).toBe(1);
      }
    }
  });
});

