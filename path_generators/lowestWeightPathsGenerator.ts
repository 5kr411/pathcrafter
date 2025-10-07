import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions } from './types';
import { enumerateActionPaths } from '../action_tree/enumerate';
import { computePathWeight } from '../utils/pathUtils';

/**
 * Enumerates paths from a tree in lowest-weight-first order
 * @param tree - The recipe tree to enumerate paths from
 * @param options - Generation options including inventory
 * @returns Generator that yields action paths in order of increasing weight
 */
export function* enumerateLowestWeightPathsGenerator(
  tree: TreeNode,
  _options: GeneratorOptions = {}
): Generator<ActionPath, void, unknown> {
  // Use the new variant-first enumerator and sort by weight
  const paths = enumerateActionPaths(tree);
  
  // Sort paths by weight (lowest first)
  const sortedPaths = paths.sort((a, b) => computePathWeight(a) - computePathWeight(b));
  
  for (const path of sortedPaths) {
    yield path;
  }
}