#!/usr/bin/env node

/**
 * Test Variant Planner - Test the variant-first system with real Minecraft data
 * 
 * This script allows testing the variant-first recipe system with actual Minecraft data
 * to validate that the system works correctly before investing time in test fixes.
 */

import { buildRecipeTree } from './action_tree/builders/treeOrchestrator';
import { enumerateActionPaths } from './action_tree/enumerate';
import { logActionTree } from './action_tree/logger';
import { VariantConstraintManager } from './action_tree/types';

// Import minecraft-data
const mcData = require('minecraft-data')('1.20.1');

interface TestConfig {
  targetItem: string;
  targetCount: number;
  inventory?: Record<string, number>;
  maxDepth?: number;
  logTree?: boolean;
  enumeratePaths?: boolean;
  maxPaths?: number;
}

function printSeparator(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(` ${title}`);
  console.log('='.repeat(60));
}

function printTreeStats(tree: any) {
  console.log('\n📊 Tree Statistics:');
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
  
  // Count different action types
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

function printPathSummary(paths: any[]) {
  console.log(`\n🛤️  Found ${paths.length} action paths`);
  
  if (paths.length === 0) {
    console.log('  No paths found - item might be available in inventory or no recipes exist');
    return;
  }
  
  // Show first few paths
  const maxShow = Math.min(3, paths.length);
  console.log(`\n📋 First ${maxShow} paths:`);
  
  for (let i = 0; i < maxShow; i++) {
    const path = paths[i];
    console.log(`\n  Path ${i + 1} (${path.length} steps):`);
    path.forEach((step: any, stepIndex: number) => {
      const what = step.what?.variants?.[0]?.value || 'unknown';
      const count = step.count || 1;
      console.log(`    ${stepIndex + 1}. ${step.action} ${what} (${count}x)`);
      
      if (step.result) {
        const resultItem = step.result.variants[0].value.item;
        const resultCount = step.result.variants[0].value.perCraftCount || 1;
        console.log(`       → ${resultCount} ${resultItem}`);
      }
      
      if (step.ingredients) {
        const ingredients = step.ingredients.variants[0].value;
        if (ingredients.length > 0) {
          const ingList = ingredients.map((ing: any) => `${ing.perCraftCount} ${ing.item}`).join(' + ');
          console.log(`       ← ${ingList}`);
        }
      }
    });
  }
  
  if (paths.length > maxShow) {
    console.log(`\n  ... and ${paths.length - maxShow} more paths`);
  }
}

function testVariantPlanner(config: TestConfig) {
  printSeparator(`Testing Variant-First System: ${config.targetItem} x${config.targetCount}`);
  
  try {
    // Convert inventory to Map
    const inventoryMap = new Map<string, number>();
    if (config.inventory) {
      Object.entries(config.inventory).forEach(([item, count]) => {
        inventoryMap.set(item, count);
      });
    }
    
    // Build context
    const context = {
      inventory: inventoryMap,
      visited: new Set<string>(),
      depth: 0,
      parentPath: [] as string[],
      config: {
        preferMinimalTools: true,
        maxDepth: config.maxDepth || 10
      },
      variantConstraints: new VariantConstraintManager()
    };
    
    console.log('\n🔧 Configuration:');
    console.log(`  Target: ${config.targetItem} x${config.targetCount}`);
    console.log(`  Inventory: ${inventoryMap.size} items`);
    if (inventoryMap.size > 0) {
      Array.from(inventoryMap.entries()).forEach(([item, count]) => {
        console.log(`    ${item}: ${count}`);
      });
    }
    console.log(`  Max Depth: ${config.maxDepth || 10}`);
    
    // Check if item exists in Minecraft data
    const itemData = mcData.itemsByName[config.targetItem];
    if (!itemData) {
      console.log(`\n❌ Error: Item '${config.targetItem}' not found in Minecraft data`);
      console.log('Available items (sample):');
      const sampleItems = Object.keys(mcData.itemsByName).slice(0, 10);
      sampleItems.forEach(item => console.log(`  ${item}`));
      console.log(`  ... and ${Object.keys(mcData.itemsByName).length - 10} more`);
      return;
    }
    
    console.log(`\n✅ Item found: ${itemData.displayName} (ID: ${itemData.id})`);
    
    // Build recipe tree
    printSeparator('Building Recipe Tree');
    const tree = buildRecipeTree(mcData, config.targetItem, config.targetCount, context);
    
    printTreeStats(tree);
    
    // Log tree structure if requested
    if (config.logTree) {
      printSeparator('Tree Structure');
      logActionTree(tree);
    }
    
    // Enumerate paths if requested
    if (config.enumeratePaths) {
      printSeparator('Enumerating Action Paths');
      const paths = enumerateActionPaths(tree);
      printPathSummary(paths);
    }
    
    printSeparator('Test Complete');
    console.log('✅ Variant-first system test completed successfully!');
    
    return {
      success: true,
      tree,
      paths: config.enumeratePaths ? enumerateActionPaths(tree) : []
    };
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Test configurations
const testConfigs: TestConfig[] = [
  {
    targetItem: 'stick',
    targetCount: 4,
    inventory: {},
    logTree: true,
    enumeratePaths: true,
    maxPaths: 5
  },
  {
    targetItem: 'wooden_pickaxe',
    targetCount: 1,
    inventory: { 'stick': 2, 'oak_planks': 3 },
    logTree: true,
    enumeratePaths: true,
    maxPaths: 3
  },
  {
    targetItem: 'iron_ingot',
    targetCount: 1,
    inventory: { 'raw_iron': 1, 'coal': 1 },
    logTree: true,
    enumeratePaths: true,
    maxPaths: 3
  },
  {
    targetItem: 'oak_planks',
    targetCount: 8,
    inventory: { 'oak_log': 2 },
    logTree: false,
    enumeratePaths: true,
    maxPaths: 2
  }
];

function runAllTests() {
  console.log('🚀 Starting Variant-First System Tests');
  console.log('This will test the system with real Minecraft data to validate functionality.\n');
  
  const results = [];
  
  for (let i = 0; i < testConfigs.length; i++) {
    const config = testConfigs[i];
    console.log(`\n🧪 Test ${i + 1}/${testConfigs.length}`);
    const result = testVariantPlanner(config);
    results.push({ config, result });
    
    if (!result?.success) {
      console.log(`\n❌ Test ${i + 1} failed, stopping execution`);
      break;
    }
    
    // Pause between tests
    if (i < testConfigs.length - 1) {
      console.log('\n⏸️  Press Enter to continue to next test...');
      // In a real scenario, you might want to add a readline pause here
    }
  }
  
  printSeparator('Final Results Summary');
  console.log(`Tests completed: ${results.length}/${testConfigs.length}`);
  
  const successful = results.filter(r => r.result?.success).length;
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${results.length - successful}`);
  
  if (successful === results.length) {
    console.log('\n🎉 All tests passed! The variant-first system is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
  }
  
  return results;
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Run all tests
    runAllTests();
  } else if (args[0] === '--help') {
    console.log('Usage: npx ts-node testVariantPlanner.ts [options]');
    console.log('');
    console.log('Options:');
    console.log('  --help              Show this help message');
    console.log('  --item <name>       Test specific item');
    console.log('  --count <number>    Target count (default: 1)');
    console.log('  --inventory <json>  Inventory as JSON object');
    console.log('  --tree              Show tree structure');
    console.log('  --paths             Enumerate action paths');
    console.log('');
    console.log('Examples:');
    console.log('  npx ts-node testVariantPlanner.ts');
    console.log('  npx ts-node testVariantPlanner.ts --item stick --count 4 --tree --paths');
    console.log('  npx ts-node testVariantPlanner.ts --item wooden_pickaxe --inventory \'{"stick":2,"oak_planks":3}\'');
  } else {
    // Parse command line arguments for single test
    const config: TestConfig = {
      targetItem: 'stick',
      targetCount: 1,
      inventory: {},
      logTree: false,
      enumeratePaths: false
    };
    
    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--item':
          config.targetItem = args[++i];
          break;
        case '--count':
          config.targetCount = parseInt(args[++i]);
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
      }
    }
    
    testVariantPlanner(config);
  }
}

export { testVariantPlanner, TestConfig };
