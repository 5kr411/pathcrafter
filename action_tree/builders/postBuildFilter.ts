/**
 * Post-build filtering for craft node variants
 * 
 * After the tree is built, filters craft nodes to only include variants
 * where all required ingredients are actually obtainable from child nodes.
 * Uses multi-pass convergence since craft nodes depend on other craft nodes.
 */

import { BuildContext } from '../types';
import { getFamilyFromName, isCombinableFamily } from './nodeBuilderHelpers';

/**
 * Tracks available items from descendants
 * Separates exact item names from family groups for precise filtering
 */
interface AvailableItems {
  exactItems: Set<string>;
  families: Set<string>;
}

/**
 * Applies post-build filtering to craft nodes in the tree
 * Runs multiple passes until convergence (no more changes)
 * 
 * @param tree - Root node of the recipe tree
 * @param context - Build context with pruning settings
 * @param mcData - Minecraft data
 */
export function applyPostBuildFiltering(
  tree: any,
  context: BuildContext,
  mcData: any
): void {
  if (!context.pruneWithWorld || !context.combineSimilarNodes) {
    return;
  }

  let changed = true;
  let passes = 0;
  const maxPasses = 10;

  while (changed && passes < maxPasses) {
    changed = filterCraftVariantsInTree(tree, context, mcData);
    passes++;
  }

  // Final pass: remove craft nodes that have required ingredients with no sources
  // This runs after convergence to ensure craft-derived items have propagated
  pruneCraftNodesWithMissingIngredients(tree, context);

  // Final pruning: remove nodes that became non-viable after the ingredient check
  pruneDeadBranches(tree);
}

/**
 * Post-order traversal to filter craft variants based on child availability
 * Also prunes dead branches (nodes with no viable variants)
 * Returns true if any changes were made
 */
function filterCraftVariantsInTree(
  node: any,
  context: BuildContext,
  mcData: any
): boolean {
  if (!node) return false;

  let changed = false;

  // Process children first (post-order traversal)
  if (node.children && node.children.variants) {
    for (const child of node.children.variants) {
      if (filterCraftVariantsInTree(child.value, context, mcData)) {
        changed = true;
      }
    }
    
    // Prune dead branches: remove children that have no viable variants
    const originalChildCount = node.children.variants.length;
    node.children.variants = node.children.variants.filter((child: any) => 
      isNodeViable(child.value)
    );
    
    if (node.children.variants.length < originalChildCount) {
      changed = true;
    }
  }

  // Filter this node's variants
  if (node.action === 'craft') {
    if (filterSingleCraftNode(node, context, mcData)) {
      changed = true;
    }
  }

  return changed;
}

/**
 * Determines if a node is still viable (has usable variants)
 * A node is viable if:
 * - It's a mine or hunt node (leaf nodes)
 * - It's a root node with at least one child (means there's a way to get it)
 * - It's a craft node with at least one result variant
 */
function isNodeViable(node: any): boolean {
  if (!node) return false;
  
  // Leaf nodes (mine/hunt) are always viable
  if (node.action === 'mine' || node.action === 'hunt' || node.action === 'smelt') {
    return true;
  }
  
  // Root nodes are viable if:
  // 1. They have children (paths to obtain the item), OR
  // 2. count=0 (item was satisfied by inventory deduction)
  if (node.action === 'root') {
    if (node.count === 0) return true;  // Satisfied by inventory
    return node.children && 
           node.children.variants && 
           node.children.variants.length > 0;
  }
  
  // Craft nodes are viable only if they have result variants
  if (node.action === 'craft') {
    return node.result && 
           node.result.variants && 
           node.result.variants.length > 0;
  }
  
  return false;
}

/**
 * Filters a single craft node's variants based on child availability
 * Returns true if variants were changed
 */
function filterSingleCraftNode(
  craftNode: any,
  _context: BuildContext,
  _mcData: any
): boolean {
  if (!craftNode.result || !craftNode.ingredients) return false;

  const originalCount = craftNode.result.variants.length;

  const available: AvailableItems = {
    exactItems: new Set<string>(),
    families: new Set<string>()
  };

  // Consider inventory as a valid source for ingredients (exact matches)
  try {
    const inv: Map<string, number> | undefined = craftNode?.context?.inventory;
    if (inv && craftNode.ingredients && craftNode.ingredients.variants) {
      for (const variant of craftNode.ingredients.variants) {
        const ingredients = variant?.value || [];
        for (const ingredient of ingredients) {
          const itemName = ingredient?.item;
          if (!itemName) continue;
          const have = inv.get(itemName) || 0;
          if (have > 0) {
            available.exactItems.add(itemName);
            // Also add family for combinable items
            if (isCombinableFamily(itemName)) {
              const family = getFamilyFromName(itemName);
              if (family) {
                available.families.add(family);
              }
            }
          }
        }
      }
    }
  } catch { /* ignore inventory inspection errors */ }

  // Collect available items from descendants
  for (const child of craftNode.children.variants || []) {
    collectAvailableItems(child.value, available);
  }


  // If no ingredients are available, clear all variants
  if (available.exactItems.size === 0 && available.families.size === 0) {
    craftNode.result.variants = [];
    craftNode.ingredients.variants = [];
    return originalCount > 0;
  }

  const resultCount = (craftNode.result.variants || []).length;
  const ingCount = (craftNode.ingredients.variants || []).length;
  const sameLength = resultCount === ingCount;

  // Helper to check if an ingredient variant is fully available
  const isIngredientVariantAvailable = (ingredientVariant: any): boolean => {
    const ingredients = ingredientVariant?.value || [];
    return ingredients.every((ingredient: any) => {
      if (!ingredient?.item) return true;

      if (available.exactItems.has(ingredient.item)) {
        return true;
      }

      if (isCombinableFamily(ingredient.item)) {
        const family = getFamilyFromName(ingredient.item);
        if (family && available.families.has(family)) {
          return true;
        }
      }

      return false;
    });
  };

  if (sameLength) {
    // Preserve original 1:1 mapping semantics when counts match
    const filteredResultVariants = craftNode.result.variants.filter(
      (_resultVariant: any, index: number) => {
        const ingredientVariant = craftNode.ingredients.variants[index];
        if (!ingredientVariant) return true;
        return isIngredientVariantAvailable(ingredientVariant);
      }
    );

    const filteredIngredientVariants = craftNode.ingredients.variants.filter(
      (_variant: any, index: number) => {
        const resultVariant = craftNode.result.variants[index];
        return filteredResultVariants.includes(resultVariant);
      }
    );

    if (filteredResultVariants.length > 0) {
      craftNode.result.variants = filteredResultVariants;
      craftNode.ingredients.variants = filteredIngredientVariants;
      return filteredResultVariants.length !== originalCount;
    }

    return false;
  }

  // Mismatch in counts (e.g., single result with many ingredient alternatives):
  // Keep the result if ANY ingredient variant is available. Prune unavailable ingredient variants.
  const availableIngredientVariants = (craftNode.ingredients.variants || []).filter(isIngredientVariantAvailable);
  if (availableIngredientVariants.length > 0) {
    const ingredientChanged = availableIngredientVariants.length !== ingCount;
    craftNode.ingredients.variants = availableIngredientVariants;
    // Keep all result variants (they do not map 1:1 to ingredient variants here)
    return ingredientChanged;
  }

  // No viable ingredient alternatives -> prune entirely
  craftNode.result.variants = [];
  craftNode.ingredients.variants = [];
  return originalCount > 0;
}

/**
 * Recursively collects available items from what nodes actually produce
 * Tracks both exact item names AND families for precise filtering
 * Only collects from craft/leaf nodes that have viable descendants
 * 
 * Uses post-order traversal: checks children first, then only collects from craft nodes
 * if their children found something (indicating the craft is viable).
 * 
 * This converges over multiple passes as craft nodes get filtered.
 */
function collectAvailableItems(
  node: any,
  available: AvailableItems
): void {
  if (!node) return;

  // Root nodes with no children are dead ends - skip entirely
  if (
    node.action === 'root' &&
    node.count !== 0 &&
    (!node.children ||
      !node.children.variants ||
      node.children.variants.length === 0)
  ) {
    return;
  }

  // Recurse into children FIRST to collect what's actually available deeper in the tree
  if (node.children && node.children.variants) {
    for (const child of node.children.variants) {
      collectAvailableItems(child.value, available);
    }
  }

  // Root nodes with children that produce items: mark the root's item as available
  // This is ONLY for dependency injection cases (e.g., stick dep for diamond_pickaxe)
  // where the root node represents an intermediate crafting step.
  //
  // CRITICAL: Only add the root item if children actually produce it.
  // When combineSimilarNodes is enabled, root nodes exist for all variants (e.g., all wood types)
  // but we should only mark a variant as available if it's actually produced by children.
  if (
    node.action === 'root' &&
    node.what &&
    node.what.variants
  ) {
    const hasChildren = node.children && node.children.variants && node.children.variants.length > 0;

    if (hasChildren) {
      // Only add items that children actually produced
      // Check recursively what children provide
      // (already handled by recursive collectAvailableItems calls above)
    } else if (node.count === 0) {
      // Inventory satisfied this root requirement
      // Check which variants are actually in inventory
      const inv: Map<string, number> | undefined = node?.context?.inventory;
      let foundInInventory = false;
      
      if (inv && node.what.variants) {
        for (const variant of node.what.variants) {
          const itemName = typeof variant.value === 'string' 
            ? variant.value 
            : variant.value?.item;
          // Accept count=0 too, because tree builder may have already deducted from inventory
          if (itemName && inv.has(itemName)) {
            // This variant IS in inventory (or was deducted from it)
            available.exactItems.add(itemName);
            if (isCombinableFamily(itemName)) {
              const family = getFamilyFromName(itemName);
              if (family) {
                available.families.add(family);
              }
            }
            foundInInventory = true;
          }
        }
      }
      
      // Fallback: if we couldn't determine from inventory, use first variant
      if (!foundInInventory && node.what.variants.length > 0) {
        const rootItem = typeof node.what.variants[0].value === 'string' 
          ? node.what.variants[0].value 
          : node.what.variants[0].value?.item;
        if (rootItem) {
          available.exactItems.add(rootItem);
        }
      }
    }
  }

  // Leaf nodes (mine/hunt): these are the base sources
  // For mine nodes, use targetItem which contains the actual drops (e.g., cobblestone from stone)
  // Fall back to 'what' for test fixtures or simplified structures
  // 
  // Note: Mine nodes that exist in the tree should correspond to blocks in the world,
  // as buildMineNodes filters based on worldBudget before creating them.
  // 
  // We only add exact items, NOT families, because world-specific resources should not make
  // all family members available. If birch_log is in the world, only birch_planks should be
  // craftable, not oak_planks or other wood variants.
  if (node.action === 'mine') {
    const targetItems = (node.targetItem?.variants || node.what?.variants || []);
    for (const variant of targetItems) {
      const itemName =
        typeof variant.value === 'string' ? variant.value : variant.value?.item;
      if (itemName) {
        available.exactItems.add(itemName);
      }
    }
  }

  // Hunt nodes: collect drops (exact items only, not families)
  if (node.action === 'hunt' && node.what && node.what.variants) {
    for (const variant of node.what.variants) {
      const itemName =
        typeof variant.value === 'string' ? variant.value : variant.value?.item;
      if (itemName) {
        available.exactItems.add(itemName);
      }
    }
  }

  // Craft nodes: only collect result variants whose ingredients are actually available
  if (
    node.action === 'craft' &&
    node.result &&
    node.result.variants &&
    node.result.variants.length > 0 &&
    node.ingredients &&
    node.ingredients.variants
  ) {
    const resultCount = node.result.variants.length;
    const ingCount = node.ingredients.variants.length;
    const sameLength = resultCount === ingCount;

    const isIngredientVariantAvailable = (ingredientVariant: any): boolean => {
      const ingredients = ingredientVariant?.value || [];
      return ingredients.every((ingredient: any) => {
        if (!ingredient?.item) return true;
        if (available.exactItems.has(ingredient.item)) return true;
        if (isCombinableFamily(ingredient.item)) {
          const family = getFamilyFromName(ingredient.item);
          if (family && available.families.has(family)) return true;
        }
        return false;
      });
    };

    if (sameLength) {
      for (let i = 0; i < node.result.variants.length; i++) {
        const resultVariant = node.result.variants[i];
        const ingredientVariant = node.ingredients.variants[i];
        if (!ingredientVariant) continue;
        if (!isIngredientVariantAvailable(ingredientVariant)) continue;
        const itemName = resultVariant.value?.item || resultVariant.value;
        if (itemName) {
          available.exactItems.add(itemName);
          if (isCombinableFamily(itemName)) {
            const family = getFamilyFromName(itemName);
            if (family) {
              available.families.add(family);
            }
          }
        }
      }
    } else {
      // When counts differ, if ANY ingredient alternative is available, mark ALL results obtainable
      const anyAvailable = node.ingredients.variants.some(isIngredientVariantAvailable);
      if (anyAvailable) {
        for (const resultVariant of node.result.variants) {
          const itemName = resultVariant.value?.item || resultVariant.value;
          if (itemName) {
            available.exactItems.add(itemName);
            if (isCombinableFamily(itemName)) {
              const family = getFamilyFromName(itemName);
              if (family) {
                available.families.add(family);
              }
            }
          }
        }
      }
    }
  }

  // Smelt nodes: only collect result variants whose inputs are actually available
  if (
    node.action === 'smelt' &&
    node.result &&
    node.result.variants &&
    node.result.variants.length > 0 &&
    node.input &&
    node.input.variants
  ) {
    const inv: Map<string, number> | undefined = node?.context?.inventory;
    
    for (let i = 0; i < node.result.variants.length; i++) {
      const resultVariant = node.result.variants[i];
      const inputVariant = node.input.variants[i];
      
      if (!inputVariant) continue;
      
      const inputItem = inputVariant.value?.item || inputVariant.value;
      if (!inputItem) continue;
      
      const inputInInventory = inv ? (inv.get(inputItem) || 0) > 0 : false;
      const inputAvailable = inputInInventory ||
        available.exactItems.has(inputItem) ||
        (isCombinableFamily(inputItem) && getFamilyFromName(inputItem) && available.families.has(getFamilyFromName(inputItem)!));
      
      if (inputAvailable) {
        const itemName = resultVariant.value?.item || resultVariant.value;
        if (itemName) {
          available.exactItems.add(itemName);
          if (isCombinableFamily(itemName)) {
            const family = getFamilyFromName(itemName);
            if (family) {
              available.families.add(family);
            }
          }
        }
      }
    }
  }
}

/**
 * Final pruning pass that removes craft nodes missing required ingredients
 * Uses inventory KEYS (not counts) to detect if ingredient was ever available
 */
function pruneCraftNodesWithMissingIngredients(node: any, context: BuildContext): void {
  if (!node) return;

  // Process children first (post-order)
  if (node.children && node.children.variants) {
    for (const child of node.children.variants) {
      pruneCraftNodesWithMissingIngredients(child.value, context);
    }
  }

  // Only check craft nodes
  if (node.action !== 'craft') return;
  if (!node.ingredients || !node.result) return;
  if (node.result.variants.length === 0) return;

  // Collect what's actually available from children
  const available: AvailableItems = {
    exactItems: new Set<string>(),
    families: new Set<string>()
  };

  // Add inventory items as available sources
  // These can be used directly or crafted into other items
  if (context.inventory) {
    for (const [itemName, count] of context.inventory.entries()) {
      if (count > 0) {
        available.exactItems.add(itemName);
        if (isCombinableFamily(itemName)) {
          const family = getFamilyFromName(itemName);
          if (family) {
            available.families.add(family);
          }
        }
      }
    }
  }

  // Also mark items as available if they have a child node with count=0
  // This means the tree builder deducted them from inventory successfully
  for (const child of node.children?.variants || []) {
    const childNode = child.value;
    if (childNode.action === 'root' && childNode.count === 0) {
      // This ingredient was satisfied by inventory deduction
      // Check which variants are actually in inventory
      const inv: Map<string, number> | undefined = childNode?.context?.inventory;
      let foundInInventory = false;
      
      if (inv && childNode.what?.variants) {
        for (const variant of childNode.what.variants) {
          const itemName = typeof variant.value === 'string'
            ? variant.value
            : variant.value?.item;
          // Accept count=0 too, because tree builder may have already deducted from inventory
          if (itemName && inv.has(itemName)) {
            // This variant IS in inventory
            available.exactItems.add(itemName);
            if (isCombinableFamily(itemName)) {
              const family = getFamilyFromName(itemName);
              if (family) {
                available.families.add(family);
              }
            }
            foundInInventory = true;
          }
        }
      }
      
      // Fallback: if we couldn't determine from inventory, use first variant
      if (!foundInInventory && childNode.what?.variants?.length > 0) {
        const itemName = typeof childNode.what.variants[0].value === 'string'
          ? childNode.what.variants[0].value
          : childNode.what.variants[0].value?.item;
        if (itemName) {
          available.exactItems.add(itemName);
        }
      }
    }
    collectAvailableItems(childNode, available);
  }

  const resultCount = (node.result.variants || []).length;
  const ingCount = (node.ingredients.variants || []).length;
  const sameLength = resultCount === ingCount;

  const isIngredientVariantAvailable = (ingredientVariant: any): boolean => {
    const ingredients = ingredientVariant?.value || [];
    return ingredients.every((ingredient: any) => {
      if (!ingredient?.item) return true;

      const isAvailableExact = available.exactItems.has(ingredient.item);
      const isAvailableFamily = isCombinableFamily(ingredient.item) &&
                                getFamilyFromName(ingredient.item) &&
                                available.families.has(getFamilyFromName(ingredient.item)!);

      if (isAvailableExact || isAvailableFamily) return true;

      // Check if this ingredient is available in current inventory in sufficient quantity
      // This handles the case where the tree builder deducted some but left enough for crafting
      const requiredCount = (ingredient.perCraftCount || 1) * (node.count || 1);
      const availableInInventory = context.inventory?.get(ingredient.item) || 0;
      return availableInInventory >= requiredCount;
    });
  };

  if (sameLength) {
    const validVariantIndices: Set<number> = new Set();
    for (let i = 0; i < node.ingredients.variants.length; i++) {
      const ingredientVariant = node.ingredients.variants[i];
      if (isIngredientVariantAvailable(ingredientVariant)) {
        validVariantIndices.add(i);
      }
    }

    if (validVariantIndices.size < node.result.variants.length) {
      node.result.variants = node.result.variants.filter((_: any, i: number) => 
        validVariantIndices.has(i)
      );
      node.ingredients.variants = node.ingredients.variants.filter((_: any, i: number) => 
        validVariantIndices.has(i)
      );
    }
  } else {
    // Length mismatch: keep results if any ingredient alternative is available; prune ingredient variants to available ones
    const availableIngredientVariants = (node.ingredients.variants || []).filter(isIngredientVariantAvailable);
    if (availableIngredientVariants.length === 0) {
      node.result.variants = [];
      node.ingredients.variants = [];
    } else {
      node.ingredients.variants = availableIngredientVariants;
    }
  }
}

/**
 * Recursively prunes non-viable child nodes
 */
function pruneDeadBranches(node: any): void {
  if (!node || !node.children || !node.children.variants) return;

  // Prune non-viable children
  node.children.variants = node.children.variants.filter((child: any) => 
    isNodeViable(child.value)
  );

  // Recurse into remaining viable children
  for (const child of node.children.variants) {
    pruneDeadBranches(child.value);
  }
}

