/**
 * Recipe tree builder - refactored for maintainability
 * 
 * This file now serves as the main entry point, re-exporting functionality
 * from the modular builders directory. The complex logic has been extracted
 * into focused, testable modules.
 */

// Re-export all utility functions for backward compatibility
export { resolveMcData } from './utils/mcDataResolver';
export { requiresCraftingTable, dedupeRecipesForItem, getIngredientCounts, hasCircularDependency, findFurnaceSmeltsForItem } from './utils/recipeUtils';
export { findSimilarItems } from './utils/itemSimilarity';
export { findBlocksThatDrop, findMobsThatDrop } from './utils/sourceLookup';

// Re-export the main buildRecipeTree function from the tree orchestrator
export { buildRecipeTree } from './builders/treeOrchestrator';

// Re-export VariantConstraintManager for variant-first system
export { VariantConstraintManager } from './types';

// Re-export all builder functions for advanced usage
export * from './builders';

// Legacy functions moved to ./builders/ directory
// Main orchestration logic is now in ./builders/treeOrchestrator.ts
// Node builders are in ./builders/*NodeBuilder.ts files
// Utility functions are in ./utils/*.ts files