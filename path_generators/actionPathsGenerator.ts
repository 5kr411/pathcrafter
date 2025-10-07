import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions } from './types';
import { enumerateActionPaths } from '../action_tree/enumerate';

/**
 * Enumerates action paths from a tree using a basic generator strategy
 * @param tree - The recipe tree to enumerate paths from
 * @param options - Generation options including inventory
 * @returns Generator that yields action paths
 */
export function* enumerateActionPathsGenerator(
  tree: TreeNode,
  _options: GeneratorOptions = {}
): Generator<ActionPath, void, unknown> {
  // Use the new variant-first enumerator
  const paths = enumerateActionPaths(tree);
  
  for (const path of paths) {
    yield path;
  }
}

