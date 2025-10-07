import { ActionPath, ActionStep, TreeNode } from '../action_tree/types';
import { GeneratorOptions, WeightedPathItem, StreamFunction } from './types';
import { computePathWeight, stepWeight } from '../utils/pathUtils';
import { getSuffixTokenFromName } from '../utils/items';
import { createEnumeratorContext } from '../utils/enumeratorFactory';
import { createPriorityStreams } from '../utils/priorityStreams';

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
  const ctx = createEnumeratorContext(options, 'composableBasic');

  function makeLeafStream(step: ActionStep): StreamFunction<WeightedPathItem> {
    const w = stepWeight(step);
    return function* () {
      yield { path: [step], weight: w };
    };
  }

  const sanitizePath = ctx.sanitizePath;
  const isPathValid = ctx.isPathValid;

  /**
   * Calculates a bias score for crafting steps based on missing consumables
   */
  function missingConsumablesScoreForCraft(step: ActionStep | null): number {
    if (!step || step.action !== 'craft') return 0;

    const resultItem = step.result && step.result.variants[0].value.item;
    const suffix = getSuffixTokenFromName(resultItem || '');
    const isTool = suffix && new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']).has(suffix);
    const ing = step.ingredients && step.ingredients.variants.length > 0 ? step.ingredients.variants[0].value : [];

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
  function missingConsumablesBiasForItem(item: WeightedPathItem): number {
    if (!item || !item.path || item.path.length === 0) return 0;

    const last = item.path[item.path.length - 1];
    if (!last || last.action !== 'craft') return 0;

    const resultItem = last.result && last.result.variants[0].value.item;
    const suffix = getSuffixTokenFromName(resultItem || '');
    const isTool = suffix && new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']).has(suffix);
    const ing = last.ingredients && last.ingredients.variants.length > 0 ? last.ingredients.variants[0].value : [];

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
    getItemScore: (item: WeightedPathItem) => item.weight + missingConsumablesBiasForItem(item),
    getParentStepScore: (step: ActionStep | null) => {
      if (!step) return 0;
      const base = stepWeight(step);
      if (step.action === 'craft') {
        return base + missingConsumablesScoreForCraft(step);
      }
      return base;
    },
    sanitizePath,
    isPathValid,
    finalizeItem: (cleaned: ActionPath) => ({ path: cleaned, weight: computePathWeight(cleaned) })
  });

  const makeStream = ctx.createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
  const stream = makeStream(tree);

  for (const item of stream()) {
    yield item.path;
  }
}

