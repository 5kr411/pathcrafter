#!/usr/bin/env node

/**
 * Test Variant Planner - Test the variant-first system with real Minecraft data
 * 
 * This script allows testing the variant-first recipe system with actual Minecraft data
 * to validate that the system works correctly before investing time in test fixes.
 */

import * as fs from 'fs';
import * as path from 'path';
import plan from './planner';
import { logActionTree } from './action_tree/logger';
import { generateTopNPathsFromGenerators } from './path_generators/generateTopN';
import { GeneratorOptions } from './path_generators/types';
import type { WorldSnapshot } from './utils/worldSnapshotTypes';
import { loadSnapshotFromFile } from './utils/worldSnapshot';
import { hoistMiningInPaths, dedupePersistentItemsInPaths } from './path_optimizations';

// Import minecraft-data
const mcData = require('minecraft-data')('1.20.1');
const WORLD_SNAPSHOT_DIR = path.resolve(__dirname, 'world_snapshots');
const DEFAULT_PER_GENERATOR = 25;

interface TestConfig {
  targetItem: string;
  targetCount: number;
  inventory?: Record<string, number>;
  maxDepth?: number;
  logTree?: boolean;
  enumeratePaths?: boolean;
  maxPaths?: number;
  pruneWithWorld?: boolean;
}

interface PlannerRunOptions {
  worldSnapshot?: WorldSnapshot;
  snapshotPath?: string;
  perGenerator?: number;
}

function findLatestSnapshotFile(dir: string): string | undefined {
  if (!fs.existsSync(dir)) {
    return undefined;
  }

  const entries = fs.readdirSync(dir)
    .map(name => path.join(dir, name))
    .filter(filePath => {
      try {
        const stat = fs.statSync(filePath);
        return stat.isFile() && filePath.endsWith('.json');
      } catch (_) {
        return false;
      }
    })
    .map(filePath => ({ filePath, mtime: fs.statSync(filePath).mtime.valueOf() }))
    .sort((a, b) => b.mtime - a.mtime);

  return entries.length > 0 ? entries[0].filePath : undefined;
}

function resolveWorldSnapshot(explicitPath?: string): { snapshot?: WorldSnapshot; path?: string } {
  const candidates = explicitPath ? [explicitPath] : [findLatestSnapshotFile(WORLD_SNAPSHOT_DIR)].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      const snapshot = loadSnapshotFromFile(resolved);
      return { snapshot, path: resolved };
    } catch (error) {
      console.error(`Failed to load world snapshot at ${resolved}:`, error);
    }
  }

  return {};
}

function createInventoryMap(inventory?: Record<string, number>): Map<string, number> {
  const map = new Map<string, number>();
  if (!inventory) {
    return map;
  }

  Object.entries(inventory).forEach(([item, count]) => {
    map.set(item, count);
  });

  return map;
}

function printSeparator(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(` ${title}`);
  console.log('='.repeat(60));
}

function printTreeStats(tree: any) {
  console.log('\nTree Statistics:');
  console.log(`  Action: ${tree.action}`);
  console.log(`  Target Count: ${tree.count}`);
  console.log(`  Variant Mode: ${tree.variantMode}`);
  console.log(`  What Variants: ${tree.what.variants.length}`);

  if (tree.what.variants.length > 0) {
    console.log(`  Primary Item: ${tree.what.variants[0].value}`);
    if (tree.what.variants.length > 1) {
      console.log(`  Variant Items: ${tree.what.variants.slice(1).map((v: any) => v.value).join(', ')}`);
    }
  }

  console.log(`  Children Count: ${tree.children.variants.length}`);

  const actionCounts: Record<string, number> = {};
  function countActions(node: any) {
    if (node.action) {
      actionCounts[node.action] = (actionCounts[node.action] || 0) + 1;
    }
    if (node.children && node.children.variants) {
      node.children.variants.forEach((child: any) => countActions(child.value));
    }
  }
  countActions(tree);

  console.log('  Action Breakdown:');
  Object.entries(actionCounts).forEach(([action, count]) => {
    console.log(`    ${action}: ${count}`);
  });
}

function printPathSummary(paths: any[], maxPaths: number) {
  console.log(`\nFound ${paths.length} action paths`);

  if (paths.length === 0) {
    console.log('  No paths found');
    return;
  }

  const maxShow = Math.min(3, paths.length);
  console.log(`\nFirst ${maxShow} paths:`);

  for (let i = 0; i < maxShow; i++) {
    const pathItem = paths[i];
    const path = pathItem.path || pathItem;
    console.log(`\n  Path ${i + 1} (${path.length} steps):`);
    path.forEach((step: any, stepIndex: number) => {
      const count = step.count || 1;

      if ((step.action === 'mine' || step.action === 'hunt') && step.targetItem?.variants) {
        if (step.what?.variants && step.what.variants.length > 1) {
          const whatVariants = formatVariantStrings(step.what.variants.map((v: any) => v.value));
          const targetVariants = formatVariantStrings(step.targetItem.variants.map((v: any) => v.value));
          const modeLabel = step.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
          console.log(`    ${stepIndex + 1}. ${step.action} [${modeLabel}] ${whatVariants} for [${modeLabel}] ${targetVariants} (${count}x)`);
        } else {
          const what = step.what?.variants?.[0]?.value || 'unknown';
          const targetVariants = formatVariantStrings(step.targetItem.variants.map((v: any) => v.value));
          const modeLabel = step.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
          console.log(`    ${stepIndex + 1}. ${step.action} ${what} for [${modeLabel}] ${targetVariants} (${count}x)`);
        }
      } else if (step.what?.variants && step.what.variants.length > 1) {
        const variantNames = formatVariantStrings(step.what.variants.map((v: any) => v.value));
        const modeLabel = step.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
        console.log(`    ${stepIndex + 1}. ${step.action} [${modeLabel}] ${variantNames} (${count}x)`);
      } else {
        const what = step.what?.variants?.[0]?.value || 'unknown';
        console.log(`    ${stepIndex + 1}. ${step.action} ${what} (${count}x)`);
      }

      if (step.result) {
        if (step.result.variants && step.result.variants.length > 1) {
          const resultVariants = formatVariantStrings(step.result.variants.map((v: any) => {
            const value = v.value;
            const quantity = value.perCraftCount || value.perSmelt || value.count || 1;
            const itemName = value.item || value;
            return `${quantity} ${itemName}`;
          }));
          const modeLabel = step.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
          console.log(`       → [${modeLabel}] ${resultVariants}`);
        } else {
          const resultItem = step.result.variants[0].value.item;
          const resultCount = step.result.variants[0].value.perCraftCount || 1;
          console.log(`       → ${resultCount} ${resultItem}`);
        }
      }

      // For smelting, also display input alongside output
      if (step.action === 'smelt' && step.input) {
        if (step.input.variants && step.input.variants.length > 1) {
          const inputVariants = formatVariantStrings(step.input.variants.map((v: any) => {
            const value = v.value;
            const quantity = value.perCraftCount || value.perSmelt || value.count || 1;
            const itemName = value.item || value;
            return `${quantity} ${itemName}`;
          }));
          const modeLabel = step.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
          console.log(`       ← [${modeLabel}] ${inputVariants}`);
        } else {
          const inputItem = step.input.variants[0].value.item;
          const inputCount = step.input.variants[0].value.perSmelt || step.input.variants[0].value.perCraftCount || 1;
          console.log(`       ← ${inputCount} ${inputItem}`);
        }
      }

      if (step.ingredients) {
        if (step.ingredients.variants && step.ingredients.variants.length > 1) {
          const ingredientVariants = formatVariantStrings(step.ingredients.variants.map((v: any) => {
            const ingList = v.value.map((ing: any) => `${ing.perCraftCount} ${ing.item}`).join(' + ');
            return ingList;
          }));
          const modeLabel = step.variantMode === 'one_of' ? 'ONE OF' : 'ANY OF';
          console.log(`       ← [${modeLabel}] ${ingredientVariants}`);
        } else {
          const ingredients = step.ingredients.variants[0].value;
          if (ingredients.length > 0) {
            const ingList = ingredients.map((ing: any) => `${ing.perCraftCount} ${ing.item}`).join(' + ');
            console.log(`       ← ${ingList}`);
          }
        }
      }
    });
  }

  if (paths.length > maxPaths) {
    console.log(`\n  ... and ${paths.length - maxPaths} more paths`);
  }
}

function formatVariantStrings(values: any[], limit: number = 3): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  values.forEach(value => {
    const str = typeof value === 'string' ? value : String(value);
    if (!seen.has(str)) {
      seen.add(str);
      unique.push(str);
    }
  });
  if (unique.length <= limit) {
    return unique.join(', ');
  }
  return `${unique.slice(0, limit).join(', ')}, +${unique.length - limit} more`;
}

async function testVariantPlanner(config: TestConfig, runOptions: PlannerRunOptions) {
  printSeparator(`Testing Variant-First System: ${config.targetItem} x${config.targetCount}`);

  try {
    const inventoryMap = createInventoryMap(config.inventory);
    const generatorInventory = createInventoryMap(config.inventory);

    console.log('\nConfiguration:');
    console.log(`  Target: ${config.targetItem} x${config.targetCount}`);
    console.log(`  Inventory: ${inventoryMap.size} items`);
    if (inventoryMap.size > 0) {
      Array.from(inventoryMap.entries()).forEach(([item, count]) => {
        console.log(`    ${item}: ${count}`);
      });
    }
    console.log(`  Max Depth: ${config.maxDepth || 10}`);
    if (config.pruneWithWorld) {
      if (runOptions.worldSnapshot) {
        console.log('  World pruning: enabled');
      } else {
        console.log('  World pruning: requested but no snapshot available');
      }
    } else {
      console.log('  World pruning: disabled');
    }

    const planOptions = {
      inventory: inventoryMap,
      pruneWithWorld: config.pruneWithWorld === true,
      worldSnapshot: runOptions.worldSnapshot,
      log: false,
      combineSimilarNodes: true,
      config: {
        preferMinimalTools: true,
        maxDepth: config.maxDepth || 10
      }
    };

    const tree = plan(mcData, config.targetItem, config.targetCount, planOptions);

    printTreeStats(tree);

    if (config.logTree) {
      printSeparator('Tree Structure');
      logActionTree(tree);
    }

    if (config.enumeratePaths) {
      printSeparator('Enumerating Action Paths');
      const perGenerator = Math.max(
        1,
        config.maxPaths || runOptions.perGenerator || DEFAULT_PER_GENERATOR
      );

      const generatorOptions: GeneratorOptions = {
        inventory: generatorInventory,
        worldSnapshot: runOptions.worldSnapshot
      };

      let paths = await generateTopNPathsFromGenerators(tree, generatorOptions, perGenerator);
      
      // Apply path optimizations
      paths = hoistMiningInPaths(paths);
      paths = dedupePersistentItemsInPaths(paths);
      
      const limitedPaths = typeof config.maxPaths === 'number' ? paths.slice(0, config.maxPaths) : paths;
      printPathSummary(limitedPaths, limitedPaths.length);
    }

    printSeparator('Test Complete');
    console.log('Variant-first system test completed successfully!');

    return {
      success: true,
      tree
    };
  } catch (error) {
    console.error('\nTest failed:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

const testConfigs: TestConfig[] = [
  {
    targetItem: 'stick',
    targetCount: 4,
    inventory: {},
    logTree: true,
    enumeratePaths: true,
    maxPaths: 5,
    pruneWithWorld: true
  },
  {
    targetItem: 'wooden_pickaxe',
    targetCount: 1,
    inventory: { stick: 2, oak_planks: 3 },
    logTree: true,
    enumeratePaths: true,
    maxPaths: 3,
    pruneWithWorld: true
  },
  {
    targetItem: 'iron_ingot',
    targetCount: 1,
    inventory: { raw_iron: 1, coal: 1 },
    logTree: true,
    enumeratePaths: true,
    maxPaths: 3,
    pruneWithWorld: true
  },
  {
    targetItem: 'oak_planks',
    targetCount: 8,
    inventory: { oak_log: 2 },
    logTree: false,
    enumeratePaths: true,
    maxPaths: 2,
    pruneWithWorld: true
  }
];

async function runAllTests(runOptions: PlannerRunOptions) {
  console.log('Starting Variant-First System Tests');
  console.log('This will test the system with real Minecraft data to validate functionality.\n');

  const results = [] as Array<{ config: TestConfig; result: any }>;

  for (let i = 0; i < testConfigs.length; i++) {
    const config = testConfigs[i];
    console.log(`\nTest ${i + 1}/${testConfigs.length}`);
    const result = await testVariantPlanner(config, runOptions);
    results.push({ config, result });

    if (!result?.success) {
      console.log(`\nTest ${i + 1} failed, stopping execution`);
      break;
    }
  }

  printSeparator('Final Results Summary');
  console.log(`Tests completed: ${results.length}/${testConfigs.length}`);

  const successful = results.filter(r => r.result?.success).length;
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${results.length - successful}`);

  if (successful === results.length) {
    console.log('\nAll tests passed! The variant-first system is working correctly.');
  } else {
    console.log('\nSome tests failed. Check the output above for details.');
  }

  return results;
}

function printHelp() {
  console.log('Usage: npx ts-node testVariantPlanner.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help              Show this help message');
  console.log('  --item <name>       Test specific item');
  console.log('  --count <number>    Target count (default: 1)');
  console.log('  --inventory <json>  Inventory as JSON object');
  console.log('  --tree              Show tree structure');
  console.log('  --paths             Enumerate action paths');
  console.log('  --max-paths <n>     Limit paths returned by generators');
  console.log('  --prune-with-world  Enable tree/world pruning');
  console.log('  --snapshot <path>   Path to world snapshot JSON (defaults to latest in world_snapshots)');
}

async function runSingleTest(args: string[], runOptions: PlannerRunOptions) {
  const config: TestConfig = {
    targetItem: 'stick',
    targetCount: 1,
    inventory: {},
    logTree: false,
    enumeratePaths: false,
    pruneWithWorld: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--item':
        config.targetItem = args[++i];
        break;
      case '--count':
        config.targetCount = parseInt(args[++i], 10);
        break;
      case '--inventory':
        try {
          config.inventory = JSON.parse(args[++i]);
        } catch (e) {
          console.error('Invalid inventory JSON:', e);
          process.exit(1);
        }
        break;
      case '--tree':
        config.logTree = true;
        break;
      case '--paths':
        config.enumeratePaths = true;
        break;
      case '--max-paths':
        config.maxPaths = parseInt(args[++i], 10);
        break;
      case '--prune-with-world':
        config.pruneWithWorld = true;
        break;
      default:
        console.warn(`Unknown argument: ${args[i]}`);
        break;
    }
  }

  await testVariantPlanner(config, runOptions);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let snapshotPath: string | undefined;
  const filteredArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--snapshot') {
      snapshotPath = rawArgs[++i];
    } else {
      filteredArgs.push(arg);
    }
  }

  const snapshotInfo = resolveWorldSnapshot(snapshotPath);
  if (snapshotInfo.snapshot && snapshotInfo.path) {
    console.log(`Using world snapshot: ${snapshotInfo.path}`);
  } else if (snapshotPath) {
    console.log('No usable world snapshot loaded. World pruning will be disabled.');
  }

  const runOptions: PlannerRunOptions = {
    worldSnapshot: snapshotInfo.snapshot,
    snapshotPath: snapshotInfo.path,
    perGenerator: DEFAULT_PER_GENERATOR
  };

  if (filteredArgs.length === 0) {
    await runAllTests(runOptions);
    return;
  }

  if (filteredArgs[0] === '--help') {
    printHelp();
    return;
  }

  await runSingleTest(filteredArgs, runOptions);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error running testVariantPlanner:', error);
    process.exit(1);
  });
}

export { testVariantPlanner, TestConfig };
