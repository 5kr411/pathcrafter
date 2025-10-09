import { buildRecipeTree } from './action_tree/builders';
import { resolveMcData } from './action_tree/utils/mcDataResolver';
import { enumerateActionPathsGenerator } from './path_generators/actionPathsGenerator';
import { VariantConstraintManager } from './action_tree/types';

async function debugSimpleMine() {
  const mcData = await resolveMcData('1.20.1');

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

  console.log('Generating paths...');
  const paths = enumerateActionPathsGenerator(tree, {});

  let count = 0;
  for (const path of paths) {
    count++;
    console.log(`Path ${count}:`, path.map(step => `${step.action}:${step.what?.variants?.[0]?.value || 'unknown'}`));
    if (count >= 3) break;
  }

  console.log(`Total paths: ${count}`);
}

debugSimpleMine().catch(console.error);
