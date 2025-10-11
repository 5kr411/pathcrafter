/**
 * Smelt node builder
 * 
 * Handles creation of smelting nodes with furnace dependencies.
 */

import {
  BuildContext,
  SmeltGroupNode,
  SmeltNode
} from '../types';
import {
  createVariantGroup,
  cloneInventoryForBranch
} from './nodeBuilderHelpers';
import {
  BuildRecipeTreeFn,
  injectWorkstationDependency
} from './dependencyInjector';

/**
 * Builds smelting nodes for an item and adds them to the root node
 */
export function buildSmeltNodes(
  primaryItem: string,
  smeltInputs: string[],
  targetCount: number,
  root: any,
  context: BuildContext,
  ctx: any,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const smeltContext = cloneInventoryForBranch(context);
  
  const smeltGroup: SmeltGroupNode = {
    action: 'smelt',
    operator: 'OR',
    variantMode: 'any_of',
    what: createVariantGroup('any_of', [primaryItem]),
    count: targetCount,
    variants: { mode: 'any_of', variants: [] },
    children: { mode: 'any_of', variants: [] },
    context: smeltContext
  };

  for (const smeltInput of smeltInputs) {
    const smeltNode: SmeltNode = {
      action: 'smelt',
      operator: 'AND',
      variantMode: 'any_of',
      what: createVariantGroup('any_of', ['furnace']),
      count: targetCount,
      input: createVariantGroup('any_of', [{
        item: smeltInput,
        perSmelt: 1
      }]),
      result: createVariantGroup('any_of', [{
        item: primaryItem,
        perSmelt: 1
      }]),
      fuel: createVariantGroup('any_of', ['coal']),
      variants: { mode: 'any_of', variants: [] },
      children: { mode: 'any_of', variants: [] },
      context: smeltContext
    };

    injectWorkstationDependency(smeltNode, 'furnace', smeltContext, ctx, buildRecipeTreeFn);

    smeltGroup.children.variants.push({ value: smeltNode });
  }

  root.children.variants.push({ value: smeltGroup });
}

