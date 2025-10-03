import { ActionPath, ActionStep, TreeNode } from '../action_tree/types';
import { GeneratorOptions, LengthPathItem, StreamFunction } from './types';

const { getSuffixTokenFromName } = require('../../utils/items');
const { createEnumeratorContext } = require('../../utils/enumeratorFactory');
const { createPriorityStreams } = require('../../utils/priorityStreams');

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
  const ctx = createEnumeratorContext(options, 'composableWithFamilies');

  function makeLeafStream(step: ActionStep): StreamFunction<LengthPathItem> {
    return function* () {
      yield { path: [step], length: 1 };
    };
  }

  const sanitizePath = ctx.sanitizePath;
  const isPathValid = ctx.isPathValid;

  /**
   * Calculates a bias score for crafting steps based on missing consumables
   */
  function missingConsumablesScoreForCraft(step: ActionStep | null): number {
    if (!step || step.action !== 'craft') return 0;

    const resultItem = step.result && step.result.item;
    const suffix = getSuffixTokenFromName(resultItem);
    const isTool = suffix && new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']).has(suffix);
    const ing = Array.isArray(step.ingredients) ? step.ingredients : [];

    let missing = 0;
    for (const i of ing) {
      const need = (i && i.perCraftCount ? i.perCraftCount : 0) * (step.count || 1);
      const have = ctx.initialSupply.get(i && i.item) || 0;
      if (need > have) {
        missing += (need - have);
      }
    }

    const bias = isTool ? 0.01 : 0.001;
    return missing * bias;
  }

  /**
   * Calculates a bias score for path items based on their final crafting step
   */
  function missingConsumablesBiasForItem(item: LengthPathItem): number {
    if (!item || !item.path || item.path.length === 0) return 0;

    const last = item.path[item.path.length - 1];
    if (!last || last.action !== 'craft') return 0;

    const resultItem = last.result && last.result.item;
    const suffix = getSuffixTokenFromName(resultItem);
    const isTool = suffix && new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']).has(suffix);
    const ing = Array.isArray(last.ingredients) ? last.ingredients : [];

    let missing = 0;
    for (const i of ing) {
      const need = (i && i.perCraftCount ? i.perCraftCount : 0) * (last.count || 1);
      const have = ctx.initialSupply.get(i && i.item) || 0;
      if (need > have) {
        missing += (need - have);
      }
    }

    const bias = isTool ? 0.01 : 0.001;
    return missing * bias;
  }

  const { makeOrStream, makeAndStream } = createPriorityStreams({
    getItemScore: (item: LengthPathItem) => item.length + missingConsumablesBiasForItem(item),
    getParentStepScore: (step: ActionStep | null) =>
      step ? 1 + (step.action === 'craft' ? missingConsumablesScoreForCraft(step) : 0) : 0,
    sanitizePath,
    isPathValid,
    finalizeItem: (cleaned: ActionPath) => ({ path: cleaned, length: cleaned.length })
  });

  const makeStream = ctx.createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
  const stream = makeStream(tree);

  for (const item of stream()) {
    yield item.path;
  }
}

