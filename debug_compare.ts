import { buildRecipeTree } from './action_tree/builders';
import { resolveMcData } from './action_tree/utils/mcDataResolver';
import { enumerateActionPathsGenerator } from './path_generators/actionPathsGenerator';
import { enumerateActionPaths } from './action_tree/enumerate';
import { VariantConstraintManager } from './action_tree/types';

async function debugCompare() {
  const mcData = await resolveMcData('1.20.1');

  console.log('Building tree with inventory...');
  const tree = buildRecipeTree(mcData, 'cobblestone', 1, {
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

  console.log('Testing old enumerate...');
  const oldPaths = enumerateActionPaths(tree);
  console.log(`Old enumerate generated ${oldPaths.length} paths`);

  console.log('Testing streaming enumerate...');
  const newPaths = Array.from(enumerateActionPathsGenerator(tree, { inventory: { wooden_pickaxe: 1 } }));
  console.log(`Streaming enumerate generated ${newPaths.length} paths`);

  if (oldPaths.length > 0 && newPaths.length === 0) {
    console.log('Old path (first):', oldPaths[0]);
  }
}

debugCompare().catch(console.error);
