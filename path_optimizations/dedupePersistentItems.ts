import { ActionPath, ActionStep } from '../action_tree/types';
import { isPersistentItem } from '../utils/persistentItemsConfig';

/**
 * Gets the result item from a craft step
 */
function getCraftResult(step: ActionStep): string | null {
  if (!step || step.action !== 'craft') return null;
  
  const result = step.result;
  if (!result || !result.variants || result.variants.length === 0) return null;
  
  const firstVariant = result.variants[0];
  if (!firstVariant || !firstVariant.value) return null;
  
  const value = firstVariant.value;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'item' in value) return value.item;
  
  return null;
}

/**
 * Optimizes a path by removing redundant crafts of persistent items
 * 
 * When a path contains multiple craft steps for the same persistent item
 * (like crafting_table or wooden_pickaxe), this function:
 * 1. Identifies the first craft of each persistent item
 * 2. Removes all subsequent crafts of that same item
 * 3. Reduces the count to 1 for the first craft (we only need one)
 * 
 * This optimization assumes persistent items don't get consumed and can be
 * reused throughout the path execution.
 * 
 * @param path - The action path to optimize
 * @returns Optimized path with redundant persistent item crafts removed
 * 
 * @example
 * // Input: [craft crafting_table, use table, craft crafting_table, use table]
 * // Output: [craft crafting_table x1, use table, use table]
 */
export function dedupePersistentItemsInPath(path: ActionPath): ActionPath {
  if (!Array.isArray(path) || path.length === 0) return path;
  
  const craftedPersistent = new Set<string>();
  const indicesToRemove = new Set<number>();
  let hasCountGreaterThanOne = false;
  
  // First pass: identify crafts of persistent items
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (!step || step.action !== 'craft') continue;
    
    const resultItem = getCraftResult(step);
    if (!resultItem || !isPersistentItem(resultItem)) continue;
    
    // Check if this persistent item has count > 1
    const count = Number(step.count) || 1;
    if (count > 1) {
      hasCountGreaterThanOne = true;
    }
    
    if (craftedPersistent.has(resultItem)) {
      // Already crafted this persistent item, mark for removal
      indicesToRemove.add(i);
    } else {
      // First time crafting this persistent item
      craftedPersistent.add(resultItem);
    }
  }
  
  // If no redundant crafts found and no counts to reduce, return original path
  if (indicesToRemove.size === 0 && !hasCountGreaterThanOne) return path;
  
  // Second pass: build optimized path
  const optimized: ActionPath = [];
  for (let i = 0; i < path.length; i++) {
    if (indicesToRemove.has(i)) continue;
    
    const step = path[i];
    
    // For the first craft of a persistent item, ensure count is 1
    if (step && step.action === 'craft') {
      const resultItem = getCraftResult(step);
      if (resultItem && isPersistentItem(resultItem)) {
        const count = Number(step.count) || 1;
        if (count > 1) {
          optimized.push({ ...step, count: 1 });
          continue;
        }
      }
    }
    
    optimized.push(step);
  }
  
  return optimized;
}

/**
 * Optimizes multiple paths by removing redundant persistent item crafts
 * 
 * @param paths - Array of action paths to optimize
 * @returns Array of optimized paths
 */
export function dedupePersistentItemsInPaths(paths: ActionPath[]): ActionPath[] {
  if (!Array.isArray(paths)) return paths;
  return paths.map(p => dedupePersistentItemsInPath(p));
}

