import { buildRecipeTree } from './action_tree/builders';
import { resolveMcData } from './action_tree/utils/mcDataResolver';
import { enumerateActionPathsGenerator } from './path_generators/actionPathsGenerator';
import { VariantConstraintManager } from './action_tree/types';

async function debugStreaming() {
  const mcData = await resolveMcData('1.20.1');

  console.log('Testing basic case (no inventory)...');
  const tree = buildRecipeTree(mcData, 'cobblestone', 1, {
    inventory: new Map(),
    visited: new Set(),
    depth: 0,
    parentPath: [],
    config: {
      preferMinimalTools: true,
      maxDepth: 10
    },
    variantConstraints: new VariantConstraintManager(),
    combineSimilarNodes: true
  });

  const paths = enumerateActionPathsGenerator(tree, {});
  let count = 0;
  for (const _path of paths) {
    count++;
    if (count >= 3) break;
  }
  console.log(`Basic case generated ${count} paths`);

  console.log('\nTesting with inventory...');
  const treeWithInv = buildRecipeTree(mcData, 'cobblestone', 1, {
    inventory: new Map([['wooden_pickaxe', 1]]),
    visited: new Set(),
    depth: 0,
    parentPath: [],
    config: {
      preferMinimalTools: true,
      maxDepth: 10
    },
    variantConstraints: new VariantConstraintManager(),
    combineSimilarNodes: true
  });

  const pathsWithInv = enumerateActionPathsGenerator(treeWithInv, { inventory: { wooden_pickaxe: 1 } });
  let countWithInv = 0;
  for (const _path of pathsWithInv) {
    countWithInv++;
    if (countWithInv >= 3) break;
  }
  console.log(`With inventory case generated ${countWithInv} paths`);
}

debugStreaming().catch(console.error);
