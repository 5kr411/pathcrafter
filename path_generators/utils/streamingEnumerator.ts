import { ActionPath, ActionStep, TreeNode } from '../../action_tree/types';
import { GeneratorOptions, StreamFunction } from '../types';
import { createEnumeratorContext } from '../../utils/enumeratorFactory';
import { createPriorityStreams, PathItem } from '../../utils/priorityStreams';

interface PathStreamItem extends PathItem {
  path: ActionPath;
}

interface StreamingScoreConfig {
  scorePath: (path: ActionPath) => number;
  scoreStep: (step: ActionStep | null) => number;
}

function normaliseConfig(config?: Partial<StreamingScoreConfig>): StreamingScoreConfig {
  return {
    scorePath: config?.scorePath ?? (() => 0),
    scoreStep: config?.scoreStep ?? (() => 0)
  };
}

export function createStreamingEnumerator(
  tree: TreeNode,
  options: GeneratorOptions = {},
  config?: Partial<StreamingScoreConfig>
): StreamFunction<PathStreamItem> {
  const scores = normaliseConfig(config);
  const ctx = createEnumeratorContext({ inventory: options.inventory });

  const priority = createPriorityStreams<PathStreamItem>({
    getItemScore: item => scores.scorePath(item.path),
    getParentStepScore: step => scores.scoreStep(step),
    finalizeItem: path => ({ path })
  });

  const makeLeafStream = (step: ActionStep): StreamFunction<PathStreamItem> => {
    return function* leaf() {
      yield { path: [step] };
    };
  };

  const makeAndStream = (children: StreamFunction<PathStreamItem>[], parent: ActionStep | null) => {
    return priority.makeAndStream(children, parent);
  };

  const makeStream = ctx.createMakeStream(makeLeafStream, priority.makeOrStream, makeAndStream);
  const streamForTree = makeStream(tree);

  return function* () {
    yield* streamForTree();
  };
}
