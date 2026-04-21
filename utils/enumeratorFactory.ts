// Removed unused ActionPath import
import { isPersistentItem } from './persistentItemsConfig';
import { makeSupplyFromInventory } from './inventory';
// Removed unused imports
// Path validation removed - tree ensures validity
import { createMakeStream } from './streamFactory';

// Validation removed - tree ensures validity

/**
 * Options for creating an enumerator context
 */
export interface EnumeratorOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  inventory?: Record<string, any> | Map<string, number> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  worldSnapshot?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  [key: string]: any;
}

/**
 * Enumerator context providing utilities for path generation
 */
export interface EnumeratorContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  invObj: Record<string, any> | null;
  initialSupply: Map<string, number>;
  isPersistentItemName: (name: string) => boolean;
  createMakeStream: typeof createMakeStream;
}

/**
 * Creates an enumerator context with utilities for path generation
 * 
 * The context provides:
 * - Initial inventory supply
 * - Persistent item detection (tools, tables, armor)
 * - Stream factory creation
 * 
 * @param options - Options including inventory
 * @returns Enumerator context with utility functions
 * 
 * @example
 * ```typescript
 * const ctx = createEnumeratorContext({
 *   inventory: { oak_log: 5 }
 * });
 * ```
 */
export function createEnumeratorContext(
  options: EnumeratorOptions = {}
): EnumeratorContext {
  const invSource = options?.inventory;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
  let invObj: Record<string, any> | null = null;

  if (invSource instanceof Map) {
    invObj = Object.fromEntries(invSource.entries());
  } else if (invSource && typeof invSource === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-data untyped
    invObj = invSource as Record<string, any>;
  }

  const initialSupply = makeSupplyFromInventory(invObj);

  return {
    invObj,
    initialSupply,
    isPersistentItemName: isPersistentItem,
    createMakeStream
  };
}

