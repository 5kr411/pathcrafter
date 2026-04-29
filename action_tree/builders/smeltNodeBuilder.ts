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
  cloneInventoryForBranch,
  createDependencyContext
} from './nodeBuilderHelpers';
import {
  BuildRecipeTreeFn,
  injectWorkstationDependency
} from './dependencyInjector';
import { getSmeltsPerUnitForFuel } from '../../utils/smeltingConfig';

/**
 * Builds smelting nodes for an item and adds them to the root node
 */
export function buildSmeltNodes(
  primaryItem: string,
  smeltInputs: string[],
  targetCount: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  root: any,
  context: BuildContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  ctx: any,
  buildRecipeTreeFn: BuildRecipeTreeFn
): void {
  const smeltContext = cloneInventoryForBranch(context);

  // Use inputs as provided by smelting config; acquisition subtree will resolve
  // how to obtain them (including via block drops or crafts).
  const effectiveInputs = Array.from(new Set(smeltInputs));
  
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

  for (const smeltInput of effectiveInputs) {
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

    // Inject input item dependency (AND): ensure we can acquire required smelt inputs
    // Note: Don't deduct inventory here - buildRecipeTreeInternal will handle inventory deduction
    const inputItemName = smeltInput;
    if (targetCount > 0) {
      const inputDepContext = createDependencyContext(inputItemName, smeltContext);
      const inputTree = buildRecipeTreeFn(ctx, [inputItemName], targetCount, inputDepContext);

      // Skip this smelt variant when the input cannot be sourced. After the
      // recursive build, inputTree.count is the residual need after inventory
      // deduction. count > 0 with no children means there is no craft, smelt,
      // mine, or hunt subtree that produces the input — emitting the smelt
      // anyway would create a path the executor can't satisfy (it would smelt
      // 0 input → 0 output, then loop retrying).
      const inputUnsourceable =
        inputTree.count > 0 &&
        (!inputTree.children?.variants || inputTree.children.variants.length === 0);
      if (inputUnsourceable) {
        continue;
      }

      smeltNode.children.variants.push({ value: inputTree });
    }

    // Inject fuel dependency (AND) when inventory doesn't already satisfy it
    const fuelName = 'coal';
    const smeltsPerUnit = getSmeltsPerUnitForFuel(fuelName) || 0;
    const requiredUnits = smeltsPerUnit > 0 ? Math.ceil(targetCount / smeltsPerUnit) : targetCount;
    const haveFuel = smeltContext.inventory?.get(fuelName) || 0;
    const needFuel = Math.max(0, requiredUnits - haveFuel);
    if (needFuel > 0) {
      const fuelDepContext = createDependencyContext(fuelName, smeltContext);
      const fuelTree = buildRecipeTreeFn(ctx, [fuelName], needFuel, fuelDepContext);
      smeltNode.children.variants.push({ value: fuelTree });
    }

    smeltGroup.children.variants.push({ value: smeltNode });
  }

  if (smeltGroup.children.variants.length === 0) {
    return;
  }

  root.children.variants.push({ value: smeltGroup });
}

