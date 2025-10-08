import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions } from './types';
import { createStreamingEnumerator } from './utils/streamingEnumerator';

function clonePath(path: ActionPath): ActionPath {
  return path.map(step => ({ ...step }));
}

/**
 * Enumerates paths from a tree in shortest-first order
 * @param tree - The recipe tree to enumerate paths from
 * @param options - Generation options including inventory
 * @returns Generator that yields action paths in order of increasing length
 */
export function* enumerateShortestPathsGenerator(
  tree: TreeNode,
  options: GeneratorOptions = {}
): Generator<ActionPath, void, unknown> {
  const stream = createStreamingEnumerator(tree, options, {
    scorePath: path => path.length,
    scoreStep: step => (step?.count ? Math.max(1, Number(step.count)) : 1)
  });

  for (const item of stream()) {
    yield clonePath(item.path);
  }
}

