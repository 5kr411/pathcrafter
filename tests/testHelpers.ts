/**
 * Test helpers for variant-first system
 */

import { VariantGroup, ActionStep, ItemReference } from '../action_tree/types';
import { resolveMcData } from '../action_tree/utils/mcDataResolver';
import { buildRecipeTree } from '../action_tree/builders';
import { enumerateActionPathsGenerator } from '../path_generators/actionPathsGenerator';

const getCache = () => (global as any).TEST_CACHE || { mcData: new Map(), trees: new Map(), paths: new Map() };

export function getCachedMcData(version: string = '1.20.1'): any {
    const cache = getCache().mcData;
    if (!cache.has(version)) {
        cache.set(version, resolveMcData(version));
    }
    return cache.get(version);
}

export function getCachedTree(mcData: any, item: string, count: number, context: any): any {
    const key = JSON.stringify({ item, count, context });
    const cache = getCache().trees;
    if (!cache.has(key)) {
        cache.set(key, buildRecipeTree(mcData, item, count, context));
    }
    return cache.get(key);
}

export function limitedPathIterator(tree: any, options: any = {}, limit: number = 20): Generator<any[], void, unknown> {
    return (function* () {
        const gen = enumerateActionPathsGenerator(tree, options);
        let count = 0;
        for (const path of gen) {
            yield path;
            count++;
            if (count >= limit) break;
        }
    })();
}

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
