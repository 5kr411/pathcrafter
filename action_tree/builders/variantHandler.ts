/**
 * Variant handler
 * 
 * Handles variant processing for recipe tree construction.
 * This includes grouping similar nodes, filtering variants by world availability,
 * and fixing craft node primary fields after filtering.
 */

import { TreeNode, CraftNode, MineLeafNode } from '../types';
import { createWorldBudgetAccessors } from '../../utils/worldBudget';

/**
 * Groups similar craft nodes with variants tracked
 * 
 * @param mcData - Minecraft data object
 * @param nodes - Array of nodes to group
 * @returns Grouped nodes with variants
 */
export function groupSimilarCraftNodes(_mcData: any, nodes: TreeNode[]): TreeNode[] {
  const craftNodes = nodes.filter((n): n is CraftNode => n.action === 'craft');
  const nonCraftNodes = nodes.filter(n => n.action !== 'craft');

  if (craftNodes.length === 0) return nodes;

  // Group craft nodes by canonical shape
  const groupsByShape = new Map<string, CraftNode[]>();
  for (const node of craftNodes) {
    const shapeKey = JSON.stringify(node.ingredients.map(ing => ing.item).sort());
    if (!groupsByShape.has(shapeKey)) {
      groupsByShape.set(shapeKey, []);
    }
    groupsByShape.get(shapeKey)!.push(node);
  }

  const groupedNodes: TreeNode[] = [];

  // Combine groups with multiple variants
  for (const [_shapeKey, group] of groupsByShape.entries()) {
    if (group.length === 1) {
      groupedNodes.push(group[0]);
      continue;
    }

    // Use first node as representative
    const representative = { ...group[0] };
    
    // Add variant information
    representative.resultVariants = group.map(n => n.result.item);
    representative.ingredientVariants = group.map(n => n.ingredients.map(ing => ing.item));
    representative.variantMode = 'one_of'; // Wood families are mutually exclusive

    // Collect all children from all variants
    const allChildren: TreeNode[] = [];
    for (const variant of group) {
      if (variant.children) {
        allChildren.push(...variant.children);
      }
    }

    // Remove duplicates and group similar children
    representative.children = groupSimilarCraftNodes(_mcData, allChildren);

    groupedNodes.push(representative);
  }

  return [...groupedNodes, ...nonCraftNodes];
}

/**
 * Groups similar mine nodes with variants tracked
 * 
 * @param mcData - Minecraft data object
 * @param nodes - Array of nodes to group
 * @returns Grouped nodes with variants
 */
export function groupSimilarMineNodes(_mcData: any, nodes: TreeNode[]): TreeNode[] {
  const mineNodes = nodes.filter((n): n is MineLeafNode => n.action === 'mine');
  const nonMineNodes = nodes.filter(n => n.action !== 'mine');

  if (mineNodes.length === 0) return nodes;

  // Group mine nodes by tool and target item suffix
  const groupsByTool = new Map<string, MineLeafNode[]>();
  for (const node of mineNodes) {
    const toolKey = node.tool || 'any';
    const targetSuffix = node.targetItem?.split('_').pop() || node.what.split('_').pop() || '';
    const key = `${toolKey}:${targetSuffix}`;
    
    if (!groupsByTool.has(key)) {
      groupsByTool.set(key, []);
    }
    groupsByTool.get(key)!.push(node);
  }

  const groupedNodes: TreeNode[] = [];

  // Combine groups with multiple variants
  for (const [_toolKey, group] of groupsByTool.entries()) {
    if (group.length === 1) {
      groupedNodes.push(group[0]);
      continue;
    }

    // Use first node as representative
    const representative = { ...group[0] };
    
    // Add variant information
    representative.whatVariants = group.map(n => n.what);
    representative.targetItemVariants = group.map(n => n.targetItem || n.what);
    representative.variantMode = 'one_of'; // Block variants are mutually exclusive

    groupedNodes.push(representative);
  }

  return [...groupedNodes, ...nonMineNodes];
}

/**
 * Filters variant arrays based on world availability
 * Removes variants that aren't available and prunes nodes with no valid variants
 * 
 * @param node - Tree node to filter
 * @param worldBudget - World budget for availability checks
 * @returns True if node should be kept, false if it should be removed
 */
export function filterVariantsByWorldAvailability(node: TreeNode, worldBudget: any): boolean {
  if (!worldBudget) return true;

  const wb = createWorldBudgetAccessors(worldBudget);

  // Handle mine leaf nodes with variants
  if (node.action === 'mine') {
    const mineLeaf = node as MineLeafNode;
    
    if (mineLeaf.whatVariants && mineLeaf.whatVariants.length > 1) {
      // Filter variants based on block availability
      const validIndices: number[] = [];
      
      for (let i = 0; i < mineLeaf.whatVariants.length; i++) {
        const blockName = mineLeaf.whatVariants[i];
        if (wb.can('blocks', blockName, mineLeaf.count)) {
          validIndices.push(i);
        }
      }

      if (validIndices.length === 0) {
        return false; // No valid variants, remove node
      }

      if (validIndices.length < mineLeaf.whatVariants.length) {
        // Update the primary block to the first valid variant
        mineLeaf.what = mineLeaf.whatVariants[validIndices[0]];
        if (mineLeaf.targetItemVariants && mineLeaf.targetItemVariants[validIndices[0]]) {
          mineLeaf.targetItem = mineLeaf.targetItemVariants[validIndices[0]];
        }

        // If only 1 variant remains, clear the variant fields (no choice to make)
        if (validIndices.length === 1) {
          delete mineLeaf.whatVariants;
          delete mineLeaf.targetItemVariants;
          delete mineLeaf.variantMode;
        } else {
          // Filter the variants to only valid ones
          mineLeaf.whatVariants = validIndices.map(i => mineLeaf.whatVariants![i]);
          if (mineLeaf.targetItemVariants) {
            mineLeaf.targetItemVariants = validIndices.map(i => mineLeaf.targetItemVariants![i]);
          }
        }
      }
    }
  }

  // Recursively filter children
  if (node.children) {
    const filteredChildren: TreeNode[] = [];
    for (const child of node.children) {
      const shouldKeep = filterVariantsByWorldAvailability(child, worldBudget);
      if (shouldKeep) {
        filteredChildren.push(child);
      }
    }
    node.children = filteredChildren;
  }

  return true;
}

/**
 * Fixes craft node primary fields after filtering to use actually available variants
 * 
 * @param node - Tree node to fix
 * @param worldBudget - World budget for availability checks
 */
export function fixCraftNodePrimaryFields(node: TreeNode, worldBudget: any): void {
  if (!worldBudget) return;

  // Recursively fix children first
  if (node.children) {
    for (const child of node.children) {
      fixCraftNodePrimaryFields(child, worldBudget);
    }
  }

  // Fix craft nodes with variants
  if (node.action === 'craft') {
    const craftNode = node as CraftNode;
    
    // If this craft node has variants and children, update primary fields
    if (craftNode.resultVariants && craftNode.ingredientVariants && 
        craftNode.resultVariants.length > 1 && craftNode.children) {
      
      // Find which variant's ingredients are actually available from children
      for (let i = 0; i < craftNode.ingredientVariants.length; i++) {
        const ingredients = craftNode.ingredientVariants[i];
        let allIngredientsAvailable = true;

        // Check if all ingredients for this variant can be provided by children
        for (const ingredient of ingredients) {
          let ingredientAvailable = false;
          
          // Look for child nodes that provide this ingredient
          for (const child of craftNode.children) {
            if (child.action === 'craft' && child.result.item === ingredient) {
              ingredientAvailable = true;
              break;
            }
            if (child.action === 'mine' && child.targetItem === ingredient) {
              ingredientAvailable = true;
              break;
            }
            // Match on suffix since variants are combined
            const childSuffix = child.action === 'craft' ? child.result.item.split('_').pop() : 
                              child.action === 'mine' ? (child.targetItem || child.what).split('_').pop() : '';
            const ingredientSuffix = ingredient.split('_').pop();
            if (childSuffix === ingredientSuffix) {
              ingredientAvailable = true;
              break;
            }
          }
          
          if (!ingredientAvailable) {
            allIngredientsAvailable = false;
            break;
          }
        }

        // If this variant's ingredients are available, use it as primary
        if (allIngredientsAvailable) {
          craftNode.result.item = craftNode.resultVariants[i];
          // Update ingredients to match this variant
          craftNode.ingredients = craftNode.ingredientVariants[i].map(item => ({
            item,
            perCraftCount: 1
          }));
          break; // Use first available variant
        }
      }
    }
  }
}

/**
 * Normalizes persistent requirements in the tree
 * 
 * @param node - Tree node to normalize
 * @param inventory - Current inventory state
 */
export function normalizePersistentRequires(node: TreeNode, inventory: any): void {
  if (!node || !node.children) return;
  
  // Check if this node requires a crafting table
  if (node.action === 'craft' && (node as any).what === 'table') {
    // Check if we already have a crafting table in inventory
    const hasTable = inventory && inventory.crafting_table && inventory.crafting_table > 0;
    
    if (!hasTable) {
      // Add crafting table requirement as first child
      const tableRequirement: any = {
        action: 'craft',
        operator: 'AND',
        what: 'inventory',
        count: 1,
        result: {
          item: 'crafting_table',
          perCraftCount: 1
        },
        ingredients: [
          {
            item: 'oak_planks',
            perCraftCount: 4
          }
        ],
        children: []
      };
      
      // Insert at beginning of children
      node.children.unshift(tableRequirement);
    }
  }
  
  // Recursively process children
  for (const child of node.children) {
    normalizePersistentRequires(child, inventory);
  }
}
