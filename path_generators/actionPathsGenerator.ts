import { ActionPath, ActionStep, TreeNode } from '../action_tree/types';
import { GeneratorOptions, PathItem, StreamFunction } from './types';

const { createEnumeratorContext } = require('../../utils/enumeratorFactory');

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
  const ctx = createEnumeratorContext(options, 'basic');

  function makeLeafStream(step: ActionStep): StreamFunction<PathItem> {
    return function* () {
      yield { path: [step] };
    };
  }

  function makeOrStream(childStreams: StreamFunction<PathItem>[]): StreamFunction<PathItem> {
    return function* () {
      for (const s of childStreams) {
        for (const item of s()) {
          yield item;
        }
      }
    };
  }

  function makeAndStream(
    childStreams: StreamFunction<PathItem>[],
    parentStepOrNull: ActionStep | null
  ): StreamFunction<PathItem> {
    return function* () {
      function* product(idx: number, acc: ActionPath): Generator<PathItem, void, unknown> {
        if (idx >= childStreams.length) {
          const final = parentStepOrNull ? acc.concat([parentStepOrNull]) : acc;
          yield { path: final };
          return;
        }
        for (const item of childStreams[idx]()) {
          yield* product(idx + 1, acc.concat(item.path));
        }
      }
      yield* product(0, []);
    };
  }

  const makeStream = ctx.createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
  const stream = makeStream(tree);

  for (const item of stream()) {
    let cleaned = ctx.sanitizePath(item.path);
    if (!ctx.isPathValid(cleaned)) {
      cleaned = item.path;
    }
    if (ctx.isPathValid(cleaned)) {
      yield cleaned;
    }
  }
}

