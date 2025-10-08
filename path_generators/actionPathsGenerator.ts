import { ActionPath, TreeNode } from '../action_tree/types';
import { GeneratorOptions } from './types';
import { createStreamingEnumerator } from './utils/streamingEnumerator';

function clonePath(path: ActionPath): ActionPath {
  return path.map(step => ({ ...step }));
}

/**
 * Enumerates action paths from a tree using a basic generator strategy
 * @param tree - The recipe tree to enumerate paths from
 * @param options - Generation options including inventory
 * @returns Generator that yields action paths
 */
export function* enumerateActionPathsGenerator(
  tree: TreeNode,
  options: GeneratorOptions = {}
): Generator<ActionPath, void, unknown> {
  const stream = createStreamingEnumerator(tree, options, {
    scorePath: () => 0,
    scoreStep: () => 0
  });

  for (const item of stream()) {
    yield clonePath(item.path);
  }
}

