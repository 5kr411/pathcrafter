import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions } from './types';
import { computePathWeight, stepWeight } from '../utils/pathUtils';
import { createStreamingEnumerator } from './utils/streamingEnumerator';

function clonePath(path: ActionPath): ActionPath {
  return path.map(step => ({ ...step }));
}

/**
 * Enumerates paths from a tree in lowest-weight-first order
 * @param tree - The recipe tree to enumerate paths from
 * @param options - Generation options including inventory
 * @returns Generator that yields action paths in order of increasing weight
 */
export function* enumerateLowestWeightPathsGenerator(
  tree: TreeNode,
  options: GeneratorOptions = {}
): Generator<ActionPath, void, unknown> {
  const stream = createStreamingEnumerator(tree, options, {
    scorePath: computePathWeight,
    scoreStep: stepWeight
  });

  for (const item of stream()) {
    yield clonePath(item.path);
  }
}