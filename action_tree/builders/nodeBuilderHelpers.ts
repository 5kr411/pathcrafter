/**
 * Shared helper functions for node builders
 * 
 * Provides common utilities used across all node builders for variant handling,
 * inventory management, and item name parsing.
 */

import { BuildContext, VariantGroup } from '../types';

/**
 * Extracts the family prefix from an item name
 * @example getFamilyFromName('oak_planks') => 'oak'
 */
export function getFamilyFromName(name: string): string | undefined {
  const parts = name.split('_');
  return parts.length > 1 ? parts[0] : undefined;
}

/**
 * Extracts the suffix from an item name
 * @example getSuffixFromName('oak_planks') => 'planks'
 */
export function getSuffixFromName(name: string): string | undefined {
  const parts = name.split('_');
  return parts.length > 1 ? parts.slice(1).join('_') : undefined;
}

/**
 * Creates a variant group with the specified mode and values
 */
export function createVariantGroup<T>(mode: 'one_of' | 'any_of', values: T[]): VariantGroup<T> {
  return {
    mode,
    variants: values.map(value => ({ value }))
  };
}

/**
 * Checks if world pruning is enabled in the build context
 */
export function isWorldPruningEnabled(context: BuildContext): boolean {
  return Boolean(context.pruneWithWorld && context.worldBudget);
}

/**
 * Clones inventory for OR branches to prevent state interference
 */
export function cloneInventoryForBranch(context: BuildContext): BuildContext {
  const invMap = context.inventory;
  const branchInventory = invMap ? new Map(invMap) : invMap;
  return { ...context, inventory: branchInventory };
}

/**
 * Creates a new build context for a dependency subtree
 */
export function createDependencyContext(
  itemName: string,
  context: BuildContext
): BuildContext {
  return {
    ...context,
    depth: context.depth + 1,
    parentPath: [...context.parentPath, itemName]
  };
}

/**
 * Creates a new build context for an ingredient subtree
 */
export function createIngredientContext(
  ingredientName: string,
  context: BuildContext,
  visited: Set<string>
): BuildContext {
  return {
    ...context,
    visited,
    depth: context.depth + 1,
    parentPath: [...context.parentPath, ingredientName],
    variantConstraints: context.variantConstraints.clone()
  };
}

