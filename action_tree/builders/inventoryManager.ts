/**
 * Inventory manager
 * 
 * Handles inventory state management for recipe tree construction.
 * This includes inventory deduction, mapping, and state tracking.
 */

import { BuildContext } from '../types';
import { makeSupplyFromInventory, mapToInventoryObject } from '../../utils/inventory';

/**
 * Creates an inventory map from build context
 * 
 * @param context - Build context containing inventory information
 * @returns Map of item names to counts
 */
export function createInventoryMap(context: BuildContext): Map<string, number> {
  const invObj = context && context.inventory && typeof context.inventory === 'object' ? context.inventory : null;
  return makeSupplyFromInventory(invObj);
}

/**
 * Deducts items from inventory map
 * 
 * @param invMap - Current inventory map
 * @param itemName - Name of item to deduct
 * @param count - Number of items to deduct
 * @returns Number of items actually deducted
 */
export function deductFromInventory(invMap: Map<string, number>, itemName: string, count: number): number {
  if (!invMap || count <= 0) return 0;
  
  const have = invMap.get(itemName) || 0;
  const use = Math.min(have, count);
  
  if (use > 0) {
    invMap.set(itemName, have - use);
  }
  
  return use;
}

/**
 * Checks if inventory has enough of an item
 * 
 * @param invMap - Current inventory map
 * @param itemName - Name of item to check
 * @param count - Number of items needed
 * @returns True if inventory has enough items
 */
export function hasEnoughInInventory(invMap: Map<string, number>, itemName: string, count: number): boolean {
  if (!invMap) return false;
  const have = invMap.get(itemName) || 0;
  return have >= count;
}

/**
 * Gets the count of an item in inventory
 * 
 * @param invMap - Current inventory map
 * @param itemName - Name of item to check
 * @returns Number of items in inventory
 */
export function getInventoryCount(invMap: Map<string, number>, itemName: string): number {
  if (!invMap) return 0;
  return invMap.get(itemName) || 0;
}

/**
 * Creates a copy of an inventory map
 * 
 * @param invMap - Source inventory map
 * @returns Copy of the inventory map
 */
export function copyInventoryMap(invMap: Map<string, number>): Map<string, number> {
  return new Map(invMap);
}

/**
 * Converts inventory map to object format
 * 
 * @param invMap - Inventory map to convert
 * @returns Object representation of inventory
 */
export function inventoryMapToObject(invMap: Map<string, number>): any {
  return mapToInventoryObject(invMap);
}

/**
 * Merges two inventory maps
 * 
 * @param baseMap - Base inventory map
 * @param additionalMap - Additional inventory to merge
 * @returns New inventory map with merged contents
 */
export function mergeInventoryMaps(baseMap: Map<string, number>, additionalMap: Map<string, number>): Map<string, number> {
  const merged = new Map(baseMap);
  
  for (const [item, count] of additionalMap) {
    const existing = merged.get(item) || 0;
    merged.set(item, existing + count);
  }
  
  return merged;
}

/**
 * Calculates missing items needed from inventory
 * 
 * @param invMap - Current inventory map
 * @param requiredItems - Map of required items and counts
 * @returns Map of missing items and counts needed
 */
export function calculateMissingItems(
  invMap: Map<string, number>, 
  requiredItems: Map<string, number>
): Map<string, number> {
  const missing = new Map<string, number>();
  
  for (const [item, needed] of requiredItems) {
    const have = getInventoryCount(invMap, item);
    const missingCount = Math.max(0, needed - have);
    
    if (missingCount > 0) {
      missing.set(item, missingCount);
    }
  }
  
  return missing;
}

/**
 * Updates build context with new inventory state
 * 
 * @param context - Original build context
 * @param invMap - New inventory map
 * @returns Updated build context
 */
export function updateContextWithInventory(context: BuildContext, invMap: Map<string, number>): BuildContext {
  return {
    ...context,
    inventory: inventoryMapToObject(invMap)
  };
}

/**
 * Checks if inventory contains persistent items (crafting table, furnace, etc.)
 * 
 * @param invMap - Current inventory map
 * @param itemName - Name of persistent item to check
 * @returns True if inventory contains the persistent item
 */
export function hasPersistentItem(invMap: Map<string, number>, itemName: string): boolean {
  return hasEnoughInInventory(invMap, itemName, 1);
}

/**
 * Deducts target count from inventory for a specific item
 * 
 * @param invMap - Current inventory map
 * @param itemName - Name of item to deduct
 * @param targetCount - Total number of items needed
 * @returns Number of items still needed after deduction
 */
export function deductTargetFromInventory(invMap: Map<string, number>, itemName: string, targetCount: number): number {
  const deducted = deductFromInventory(invMap, itemName, targetCount);
  return Math.max(0, targetCount - deducted);
}
