import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions } from './types';
import { enumerateActionPaths } from '../action_tree/enumerate';

/**
 * Enumerates paths from a tree in shortest-first order
 * @param tree - The recipe tree to enumerate paths from
 * @param options - Generation options including inventory
 * @returns Generator that yields action paths in order of increasing length
 */
export function* enumerateShortestPathsGenerator(
  tree: TreeNode,
  _options: GeneratorOptions = {}
): Generator<ActionPath, void, unknown> {
  // Use the new variant-first enumerator and sort by length
  const paths = enumerateActionPaths(tree);
  
  // Sort paths by length (shortest first)
  const sortedPaths = paths.sort((a, b) => a.length - b.length);
  
  for (const path of sortedPaths) {
    yield path;
  }
}

