/**
 * Node builders index
 * 
 * Exports all node builder functions for recipe tree construction.
 */

// Legacy builders removed - functionality moved to treeOrchestrator.ts
export { createInventoryMap, deductFromInventory, hasEnoughInInventory, getInventoryCount, copyInventoryMap, inventoryMapToObject, mergeInventoryMaps, calculateMissingItems, updateContextWithInventory, hasPersistentItem, deductTargetFromInventory } from './inventoryManager';
export { buildRecipeTree } from './treeOrchestrator';
