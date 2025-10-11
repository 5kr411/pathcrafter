/**
 * Variant resolution logic
 * 
 * Handles variant constraint resolution, filtering, and mode determination
 * for the variant-first tree building system.
 */

import { BuildContext, VariantGroup, VariantConstraintManager } from '../types';
import { canConsumeWorld, ResourceKind } from '../../utils/worldBudget';
import { getFamilyFromName, getSuffixFromName, isWorldPruningEnabled as isWorldPruningEnabledHelper } from './nodeBuilderHelpers';

export { isWorldPruningEnabledHelper as isWorldPruningEnabled };

/**
 * Result of variant resolution for an item
 */
export interface VariantResolution {
  variantsToUse: string[];
  variantMode: 'one_of' | 'any_of';
}

/**
 * Resolves which variants to use for an item based on constraints
 * 
 * Checks the variant constraint manager to determine if there are
 * required variants or allowed variants, and returns the appropriate
 * list with the correct mode.
 */
export function resolveVariantsForItem(
  itemGroup: string[],
  context: BuildContext
): VariantResolution {
  const constraintManager = context.variantConstraints;
  const primaryItem = itemGroup[0];
  
  const requiredVariant = constraintManager.getRequiredVariant(primaryItem);
  const allowedVariants = constraintManager.getAllowedVariants(primaryItem);
  
  let variantsToUse: string[];
  let variantMode: 'one_of' | 'any_of';
  
  if (requiredVariant) {
    variantsToUse = [requiredVariant];
    variantMode = 'one_of';
  } else if (allowedVariants.length > 0) {
    variantsToUse = allowedVariants;
    variantMode = 'any_of';
  } else {
    variantsToUse = itemGroup;
    variantMode = 'one_of';
  }
  
  return { variantsToUse, variantMode };
}

/**
 * Filters resource variants based on world budget availability
 * 
 * If world pruning is enabled, filters variants to only those that
 * are available in the world budget. Returns all variants if pruning
 * is disabled or if all variants are filtered out.
 */
export function filterResourceVariants(
  context: BuildContext,
  kind: ResourceKind,
  variants: string[]
): string[] {
  const unique = Array.from(new Set(variants));
  if (!isWorldPruningEnabledHelper(context)) {
    return unique;
  }

  const worldBudget = context.worldBudget!;
  const filtered = unique.filter(name => canConsumeWorld(worldBudget, kind, name, 1));
  if (filtered.length === 0) {
    return [];
  }

  return filtered;
}

/**
 * Creates a variant group with family and suffix metadata
 */
export function createVariantGroupWithMetadata<T>(
  mode: 'one_of' | 'any_of',
  values: T[],
  getItemName: (value: T) => string
): VariantGroup<T> {
  return {
    mode,
    variants: values.map(value => ({
      value,
      metadata: {
        family: getFamilyFromName(getItemName(value)),
        suffix: getSuffixFromName(getItemName(value))
      }
    }))
  };
}

/**
 * Adds a variant constraint for downstream nodes
 */
export function addVariantConstraint(
  constraintManager: VariantConstraintManager,
  primaryItem: string,
  variantsToUse: string[],
  variantMode: 'one_of' | 'any_of',
  context: BuildContext
): void {
  if (variantMode === 'one_of') {
    constraintManager.addConstraint(primaryItem, {
      type: 'one_of',
      availableVariants: variantsToUse,
      constraintPath: context.parentPath
    });
  }
}

/**
 * Determines which target items can be obtained from available blocks
 */
export function determineTargetItemsFromBlocks(
  mcData: any,
  blocks: string[],
  possibleTargets: string[]
): string[] {
  const filteredTargetItems = new Set<string>();
  
  for (const blockName of blocks) {
    const block = Object.values(mcData.blocks).find((b: any) => b.name === blockName);
    if (block && (block as any).drops) {
      (block as any).drops.forEach((dropId: number) => {
        const itemName = mcData.items[dropId]?.name;
        if (itemName && possibleTargets.includes(itemName)) {
          filteredTargetItems.add(itemName);
        }
      });
    }
  }
  
  return filteredTargetItems.size > 0 ? Array.from(filteredTargetItems) : possibleTargets;
}

/**
 * Determines which target items can be obtained from available mobs
 */
export function determineTargetItemsFromMobs(
  mcData: any,
  mobs: string[],
  possibleTargets: string[]
): string[] {
  const filteredTargetItems = new Set<string>();
  
  for (const mobName of mobs) {
    Object.entries(mcData.entityLoot || {}).forEach(([_entityId, lootTable]: [string, any]) => {
      if (lootTable && lootTable.entity === mobName && lootTable.drops) {
        lootTable.drops.forEach((drop: any) => {
          const dropItemName = drop.item?.toLowerCase().replace(' ', '_');
          if (dropItemName && possibleTargets.includes(dropItemName)) {
            filteredTargetItems.add(dropItemName);
          }
        });
      }
    });
  }
  
  return filteredTargetItems.size > 0 ? Array.from(filteredTargetItems) : possibleTargets;
}

