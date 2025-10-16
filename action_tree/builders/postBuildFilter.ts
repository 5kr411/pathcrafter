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
  
  // Root nodes are only viable if they have children (paths to obtain the item)
  if (node.action === 'root') {
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

  const filteredResultVariants = craftNode.result.variants.filter(
    (_resultVariant: any, index: number) => {
      const ingredientVariant = craftNode.ingredients.variants[index];
      if (!ingredientVariant) return true;

      const ingredients = ingredientVariant.value || [];

      const result = ingredients.every((ingredient: any) => {
        if (!ingredient?.item) return true;
        
        // Check if exact ingredient is available
        if (available.exactItems.has(ingredient.item)) {
          return true;
        }
        
        // For combinable items, check family match
        if (isCombinableFamily(ingredient.item)) {
          const family = getFamilyFromName(ingredient.item);
          if (family && available.families.has(family)) {
            return true;
          }
        }
        
        return false;
      });
      
      return result;
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
    (!node.children ||
      !node.children.variants ||
      node.children.variants.length === 0)
  ) {
    return;
  }

  // Recurse into children FIRST to collect what's actually available deeper in the tree
  const childAvailable: AvailableItems = {
    exactItems: new Set<string>(),
    families: new Set<string>()
  };
  if (node.children && node.children.variants) {
    for (const child of node.children.variants) {
      collectAvailableItems(child.value, childAvailable);
    }
  }

  // Leaf nodes (mine/hunt): these are the base sources - always collect
  // For mine nodes, use targetItem which contains the actual drops (e.g., cobblestone from stone)
  // Fall back to 'what' for test fixtures or simplified structures
  if (node.action === 'mine') {
    const targetItems = (node.targetItem?.variants || node.what?.variants || []);
    for (const variant of targetItems) {
      const itemName =
        typeof variant.value === 'string' ? variant.value : variant.value?.item;
      if (itemName) {
        available.exactItems.add(itemName);
        // Add family only for combinable items (wood types)
        if (isCombinableFamily(itemName)) {
          const family = getFamilyFromName(itemName);
          if (family) {
            available.families.add(family);
          }
        }
      }
    }
  }

  // Hunt nodes: collect drops
  if (node.action === 'hunt' && node.what && node.what.variants) {
    for (const variant of node.what.variants) {
      const itemName =
        typeof variant.value === 'string' ? variant.value : variant.value?.item;
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

  // Craft nodes: only collect result variants whose ingredients are actually available
  if (
    node.action === 'craft' &&
    node.result &&
    node.result.variants &&
    node.result.variants.length > 0 &&
    node.ingredients &&
    node.ingredients.variants
  ) {
    for (let i = 0; i < node.result.variants.length; i++) {
      const resultVariant = node.result.variants[i];
      const ingredientVariant = node.ingredients.variants[i];
      
      if (!ingredientVariant) continue;
      
      const ingredients = ingredientVariant.value || [];
      const allIngredientsAvailable = ingredients.every((ingredient: any) => {
        if (!ingredient?.item) return true;
        
        // Check if ingredient is in child-available items
        if (childAvailable.exactItems.has(ingredient.item)) {
          return true;
        }
        
        // For combinable items, check family match
        if (isCombinableFamily(ingredient.item)) {
          const family = getFamilyFromName(ingredient.item);
          if (family && childAvailable.families.has(family)) {
            return true;
          }
        }
        
        return false;
      });
      
      if (allIngredientsAvailable) {
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

  // Smelt nodes: only collect result variants whose inputs are actually available
  if (
    node.action === 'smelt' &&
    node.result &&
    node.result.variants &&
    node.result.variants.length > 0 &&
    node.input &&
    node.input.variants
  ) {
    for (let i = 0; i < node.result.variants.length; i++) {
      const resultVariant = node.result.variants[i];
      const inputVariant = node.input.variants[i];
      
      if (!inputVariant) continue;
      
      const inputItem = inputVariant.value?.item || inputVariant.value;
      if (!inputItem) continue;
      
      const inputAvailable = childAvailable.exactItems.has(inputItem) ||
        (isCombinableFamily(inputItem) && getFamilyFromName(inputItem) && childAvailable.families.has(getFamilyFromName(inputItem)!));
      
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

  // Merge child availability
  for (const item of childAvailable.exactItems) {
    available.exactItems.add(item);
  }
  for (const family of childAvailable.families) {
    available.families.add(family);
  }
}

