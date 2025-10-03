import { ActionPath } from '../action_tree/types';
import { buildPersistentNamesSet, isPersistentItemName } from './persistence';
import { makeSupplyFromInventory } from './inventory';
import { getSmeltsPerUnitForFuel } from './smeltingConfig';
import { isPathValidBasic, isPathComposableBasic } from './pathValidation';
import { sanitizePath as sanitizePathShared } from './sanitizer';
import { createMakeStream } from './streamFactory';

/**
 * Validation mode for path checking
 */
export type ValidationMode = 'basic' | 'composableBasic' | 'composableWithFamilies';

/**
 * Options for creating an enumerator context
 */
export interface EnumeratorOptions {
  inventory?: Record<string, any>;
  [key: string]: any;
}

/**
 * Enumerator context providing utilities for path generation
 */
export interface EnumeratorContext {
  invObj: Record<string, any> | null;
  initialSupply: Map<string, number>;
  isPersistentItemName: (name: string) => boolean;
  isPathValid: (path: ActionPath) => boolean;
  sanitizePath: (path: ActionPath) => ActionPath;
  createMakeStream: typeof createMakeStream;
}

/**
 * Creates an enumerator context with utilities for path generation
 * 
 * The context provides:
 * - Initial inventory supply
 * - Persistent item detection (tools, tables)
 * - Path validation
 * - Path sanitization
 * - Stream factory creation
 * 
 * @param options - Options including inventory
 * @param validation - Validation mode ('basic' or 'composableBasic')
 * @returns Enumerator context with utility functions
 * 
 * @example
 * ```typescript
 * const ctx = createEnumeratorContext({
 *   inventory: { oak_log: 5 }
 * }, 'basic');
 * 
 * const isValid = ctx.isPathValid(path);
 * const cleaned = ctx.sanitizePath(path);
 * ```
 */
export function createEnumeratorContext(
  options: EnumeratorOptions = {},
  validation: ValidationMode = 'basic'
): EnumeratorContext {
  const invObj = options && options.inventory && typeof options.inventory === 'object' 
    ? options.inventory 
    : null;

  const persistentNames = buildPersistentNamesSet();
  
  function isPersistentItemNameLocal(name: string): boolean {
    return isPersistentItemName(name, persistentNames);
  }

  const initialSupply = makeSupplyFromInventory(invObj);

  function selectValidator(kind: ValidationMode): (path: ActionPath) => boolean {
    if (kind === 'basic') {
      return (path) => isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel);
    }
    if (kind === 'composableBasic' || kind === 'composableWithFamilies') {
      return (path) => isPathComposableBasic(path, initialSupply, getSmeltsPerUnitForFuel);
    }
    return (path) => isPathValidBasic(path, initialSupply, getSmeltsPerUnitForFuel);
  }

  const isPathValid = selectValidator(validation);

  function sanitizePath(path: ActionPath): ActionPath {
    return sanitizePathShared(path, {
      isPersistentName: isPersistentItemNameLocal,
      isPathValid,
      getSmeltsPerUnitForFuel
    });
  }

  return {
    invObj,
    initialSupply,
    isPersistentItemName: isPersistentItemNameLocal,
    isPathValid,
    sanitizePath,
    createMakeStream
  };
}

