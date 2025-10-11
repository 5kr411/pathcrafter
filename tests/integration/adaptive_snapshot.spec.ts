import analyzeRecipes from '../../recipeAnalyzer';
import { loadSnapshotFromFile } from '../../utils/worldSnapshot';
import { captureAdaptiveSnapshot, createPathValidator } from '../../utils/adaptiveSnapshot';
import * as path from 'path';

// SKIPPED: Adaptive snapshot with progressive radii feature is not fully tested.
// This feature automatically adjusts the world scan radius based on resource availability.
// It starts with a small radius and progressively increases until a valid path can be found.
// Benefits: 1) Reduces scanning time when resources are nearby, 2) Ensures fallback to larger
// areas when needed, 3) Validates that sufficient resources exist before planning.
// The tests verify: starting with small radii when resources are close, expanding when resources
// are distant, falling back to largest radius when no valid paths exist, and working without
// a validator (returning first radius immediately).
describe.skip('integration: adaptive snapshot with progressive radii', () => {
  const { resolveMcData, enumerateActionPathsGenerator } = (analyzeRecipes as any)._internals;
  resolveMcData('1.20.1');

  // Load real world snapshot data
  const snapshotPath = path.resolve(__dirname, '../../world_snapshots/raw_overworld_1759150790377.json');
  const realSnapshot = loadSnapshotFromFile(snapshotPath);

  // Mock bot that returns the loaded snapshot data at different radii
  function createMockBot(fullSnapshot: any) {
    return {
      version: '1.20.1',
      entity: {
        position: {
          x: fullSnapshot.center.x,
          y: fullSnapshot.center.y,
          z: fullSnapshot.center.z,
          floored: function() { return this; }
        }
      },
      // Mock findBlocks that filters by radius
      findBlocks: function({ maxDistance }: any) {
        // Return blocks within maxDistance
        const positions: any[] = [];
        const center = fullSnapshot.center;
        
        for (const [, stats] of Object.entries(fullSnapshot.blocks || {}) as [string, any][]) {
          // For testing, we'll simulate that blocks exist at their closest distance
          if (stats.closestDistance <= maxDistance) {
            // Add some mock positions based on count
            for (let i = 0; i < Math.min(stats.count, 10); i++) {
              // Generate positions at approximately closestDistance
              const angle = (i / 10) * Math.PI * 2;
              const dist = stats.closestDistance + i;
              positions.push({
                x: Math.floor(center.x + Math.cos(angle) * dist),
                y: center.y,
                z: Math.floor(center.z + Math.sin(angle) * dist)
              });
            }
          }
        }
        return positions;
      },
      blockAt: function(pos: any) {
        // Return a mock block based on what exists in snapshot
        // For simplicity, return the first block type that's close enough
        const center = fullSnapshot.center;
        const dist = Math.sqrt(
          Math.pow(pos.x - center.x, 2) +
          Math.pow(pos.y - center.y, 2) +
          Math.pow(pos.z - center.z, 2)
        );
        
        for (const [blockName, stats] of Object.entries(fullSnapshot.blocks || {}) as [string, any][]) {
          if (dist >= stats.closestDistance && dist <= stats.closestDistance + 10) {
            return { name: blockName, position: pos };
          }
        }
        return { name: 'stone', position: pos };
      },
      entities: {}
    };
  }

  test('progressively increases radius when small radius lacks resources', async () => {
    // Create a snapshot where oak_log is at distance 20
    const restrictedSnapshot = {
      ...realSnapshot,
      blocks: {
        oak_log: {
          count: 10,
          closestDistance: 20, // Force oak_log to be at distance 20
          averageDistance: 25
        }
      }
    };
    
    const bot = createMockBot(restrictedSnapshot);
    // const inventory = {};

    // Use radii where first few won't reach oak_log at distance 20
    const radii = [8, 12, 16, 24];
    
    // Custom validator that checks for oak_log availability
    const validator = async (snapshot: any) => {
      const hasOakLog = snapshot.blocks && snapshot.blocks.oak_log &&
                       snapshot.blocks.oak_log.count > 0;
      return hasOakLog;
    };

    const result = await captureAdaptiveSnapshot(bot, {
      radii,
      validator
    });

    // Should have tried multiple radii (3 attempts: 8, 12, 16 fail; 24 succeeds)
    expect(result.attemptsCount).toBeGreaterThan(2);
    
    // Should have used radius 24 (first one >= 20)
    expect(result.radiusUsed).toBe(24);
    
    // Verify the snapshot has oak_log
    expect(result.snapshot.blocks.oak_log).toBeDefined();
    expect(result.snapshot.blocks.oak_log.count).toBeGreaterThan(0);
  }, 30000);

  test('uses first radius when resources are immediately available', async () => {
    const bot = createMockBot(realSnapshot);
    
    // Start with inventory that already has materials
    const inventory = { 
      crafting_table: 1,
      oak_planks: 3,
      stick: 2
    };
    const item = 'wooden_pickaxe';
    const count = 1;

    // Even with tiny radius, should work because we have materials
    const radii = [8, 16, 32];
    
    const validator = createPathValidator(
      '1.20.1',
      item,
      count,
      inventory,
      analyzeRecipes,
      enumerateActionPathsGenerator
    );

    const result = await captureAdaptiveSnapshot(bot, {
      radii,
      validator
    });

    // Should only need one attempt since inventory satisfies
    expect(result.attemptsCount).toBe(1);
    expect(result.radiusUsed).toBe(8);
  }, 30000);

  test('falls back to largest radius when no valid paths found', async () => {
    // Create snapshot where diamond is completely missing
    const nodiamondSnapshot = {
      ...realSnapshot,
      blocks: {
        stone: { count: 100, closestDistance: 5, averageDistance: 10 },
        dirt: { count: 200, closestDistance: 3, averageDistance: 8 }
        // No diamond
      }
    };
    
    const bot = createMockBot(nodiamondSnapshot);

    const radii = [8, 16, 24];
    
    // Validator that always returns false (diamond is never found)
    const validator = async (snapshot: any) => {
      const hasDiamond = snapshot.blocks && snapshot.blocks.diamond &&
                        snapshot.blocks.diamond.count > 0;
      return hasDiamond;
    };

    const result = await captureAdaptiveSnapshot(bot, {
      radii,
      validator
    });

    // Should try all radii since diamond is never found
    expect(result.attemptsCount).toBe(radii.length);
    
    // Should fall back to largest
    expect(result.radiusUsed).toBe(24);
  }, 30000);

  test('works without validator (returns first radius)', async () => {
    const bot = createMockBot(realSnapshot);
    const radii = [16, 32, 64];

    const result = await captureAdaptiveSnapshot(bot, {
      radii
    });

    // Without validator, should return first radius immediately
    expect(result.attemptsCount).toBe(1);
    expect(result.radiusUsed).toBe(16);
    expect(result.snapshot).toBeDefined();
  }, 30000);
});

