/**
 * Post-build filtering for craft node variants
 * 
 * After the tree is built, filters craft nodes to only include variants
 * where all required ingredients are actually obtainable from child nodes.
 * Uses multi-pass convergence since craft nodes depend on other craft nodes.
 */

import { BuildContext } from '../types';
import { getFamilyFromName } from './nodeBuilderHelpers';

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

  const availableIngredientFamilies = new Set<string>();

  // Consider inventory as a valid source for ingredients
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
            const family = getFamilyFromName(itemName);
            if (family) {
              availableIngredientFamilies.add(family);
            } else {
              availableIngredientFamilies.add(itemName);
            }
          }
        }
      }
    }
  } catch { /* ignore inventory inspection errors */ }

  for (const child of craftNode.children.variants || []) {
    collectAvailableFamiliesFromNode(child.value, availableIngredientFamilies);
  }

  // If no ingredients are available, clear all variants
  if (availableIngredientFamilies.size === 0) {
    craftNode.result.variants = [];
    craftNode.ingredients.variants = [];
    return originalCount > 0;
  }

  const filteredResultVariants = craftNode.result.variants.filter(
    (_resultVariant: any, index: number) => {
      const ingredientVariant = craftNode.ingredients.variants[index];
      if (!ingredientVariant) return true;

      const ingredients = ingredientVariant.value || [];

      return ingredients.every((ingredient: any) => {
        if (!ingredient?.item) return true;
        const family = getFamilyFromName(ingredient.item);
        return (
          (family && availableIngredientFamilies.has(family)) ||
          availableIngredientFamilies.has(ingredient.item)
        );
      });
    }
  );

  const filteredIngredientVariants = craftNode.ingredients.variants.filter(
    (_variant: any) => {
      const ingredients = _variant.value || [];

      return ingredients.every((ingredient: any) => {
        if (!ingredient?.item) return true;
        const family = getFamilyFromName(ingredient.item);
        return (
          (family && availableIngredientFamilies.has(family)) ||
          availableIngredientFamilies.has(ingredient.item)
        );
      });
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
 * Recursively collects available item families/names from what nodes actually produce
 * Only collects from craft/leaf nodes that have viable descendants
 * 
 * Uses post-order traversal: checks children first, then only collects from craft nodes
 * if their children found something (indicating the craft is viable).
 * 
 * This converges over multiple passes as craft nodes get filtered.
 */
function collectAvailableFamiliesFromNode(
  node: any,
  families: Set<string>
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
  const childFamilies = new Set<string>();
  if (node.children && node.children.variants) {
    for (const child of node.children.variants) {
      collectAvailableFamiliesFromNode(child.value, childFamilies);
    }
  }

  // Leaf nodes (mine/hunt): these are the base sources - always collect
  if (
    (node.action === 'mine' || node.action === 'hunt') &&
    node.what &&
    node.what.variants
  ) {
    for (const variant of node.what.variants) {
      const itemName =
        typeof variant.value === 'string' ? variant.value : variant.value?.item;
      if (itemName) {
        const family = getFamilyFromName(itemName);
        if (family) {
          families.add(family);
        } else {
          families.add(itemName);
        }
      }
    }
  }

  // Craft nodes: only collect if children found something (craft is viable)
  if (
    node.action === 'craft' &&
    childFamilies.size > 0 &&
    node.result &&
    node.result.variants &&
    node.result.variants.length > 0
  ) {
    for (const variant of node.result.variants) {
      const itemName = variant.value?.item || variant.value;
      if (itemName) {
        const family = getFamilyFromName(itemName);
        if (family) {
          families.add(family);
        } else {
          families.add(itemName);
        }
      }
    }
  }

  // Smelt nodes: like craft, consider produced items available when dependencies are viable
  if (
    node.action === 'smelt' &&
    childFamilies.size > 0 &&
    node.result &&
    node.result.variants &&
    node.result.variants.length > 0
  ) {
    for (const variant of node.result.variants) {
      const itemName = variant.value?.item || variant.value;
      if (itemName) {
        const family = getFamilyFromName(itemName);
        if (family) {
          families.add(family);
        } else {
          families.add(itemName);
        }
      }
    }
  }

  // Add all families found in children
  for (const family of childFamilies) {
    families.add(family);
  }
}

