/**
 * Test helpers for variant-first system
 */

import { VariantGroup, ActionStep, ItemReference } from '../action_tree/types';

/**
 * Creates a VariantGroup from a single value
 */
export function createVariantGroup<T>(mode: 'one_of' | 'any_of', value: T): VariantGroup<T> {
  return {
    mode,
    variants: [{ value }]
  };
}

/**
 * Creates a VariantGroup from multiple values
 */
export function createVariantGroupFromArray<T>(mode: 'one_of' | 'any_of', values: T[]): VariantGroup<T> {
  return {
    mode,
    variants: values.map(value => ({ value }))
  };
}

/**
 * Creates an ActionStep for testing
 */
export function createTestActionStep(overrides: Partial<ActionStep> = {}): ActionStep {
  return {
    action: 'craft',
    variantMode: 'one_of',
    what: createVariantGroup('one_of', 'inventory'),
    count: 1,
    ...overrides
  };
}

/**
 * Creates an ItemReference for testing
 */
export function createTestItemReference(item: string, perCraftCount: number = 1): ItemReference {
  return {
    item,
    perCraftCount
  };
}

/**
 * Creates a VariantGroup<string> for testing
 */
export function createTestStringGroup(value: string): VariantGroup<string> {
  return createVariantGroup('one_of', value);
}

/**
 * Creates a VariantGroup<ItemReference> for testing
 */
export function createTestItemReferenceGroup(item: string, perCraftCount: number = 1): VariantGroup<ItemReference> {
  return createVariantGroup('one_of', createTestItemReference(item, perCraftCount));
}

/**
 * Creates a VariantGroup<ItemReference[]> for testing
 */
export function createTestIngredientGroup(ingredients: ItemReference[]): VariantGroup<ItemReference[]> {
  return createVariantGroup('one_of', ingredients);
}

/**
 * Creates a VariantGroup<ItemReference> with multiple variants for testing
 */
export function createTestItemReferenceGroupFromArray(mode: 'one_of' | 'any_of', items: Array<{item: string, perCraftCount: number}>): VariantGroup<ItemReference> {
  return {
    mode,
    variants: items.map(item => ({ value: item }))
  };
}
