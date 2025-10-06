/**
 * Craft node builder
 * 
 * Handles building craft nodes for recipe tree construction.
 * This includes ingredient processing, variant handling, and feasibility checks.
 */

import { MinecraftData, CraftNode, MinecraftRecipe } from '../types';
import { BuildContext } from '../types';
import { requiresCraftingTable, getIngredientCounts } from '../utils/recipeUtils';
import { hasCircularDependency } from '../utils/recipeUtils';
import { findBlocksThatDrop } from '../utils/sourceLookup';
import { chooseMinimalToolName } from '../../utils/items';
import { createWorldBudgetAccessors } from '../../utils/worldBudget';

/**
 * Builds a craft node from a recipe group
 * 
 * @param mcData - Minecraft data object
 * @param recipeGroup - Group of similar recipes (variants)
 * @param targetCount - Number of items needed
 * @param invMap - Current inventory state
 * @param context - Build context with configuration
 * @param visited - Set of visited items to prevent infinite recursion
 * @param buildRecipeTreeInternal - Reference to the main tree building function
 * @returns Craft node or null if recipe is infeasible
 */
export function buildCraftNode(
  mcData: MinecraftData,
  recipeGroup: Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}>,
  targetCount: number,
  invMap: Map<string, number>,
  context: BuildContext,
  visited: Set<string>,
  buildRecipeTreeInternal: Function
): CraftNode | null {
  // Use first recipe as representative
  const recipe = recipeGroup[0].recipe;
  const craftingsNeeded = Math.ceil(targetCount / recipe.result.count);
  const ingredientCounts = getIngredientCounts(recipe);

  // Create craft node with the recipe's ingredients
  const craftNode: CraftNode = {
    action: 'craft',
    operator: 'AND',
    what: requiresCraftingTable(recipe) ? 'table' : 'inventory',
    count: craftingsNeeded,
    result: {
      item: recipeGroup[0].itemName,
      perCraftCount: recipe.result.count
    },
    ingredients: Array.from(ingredientCounts.entries())
      .sort(([a], [b]) => a - b)
      .map(([id, count]) => {
        const ingName = mcData.items[id]?.name;
        return {
          item: ingName,
          perCraftCount: count
        };
      }),
    children: []
  };
  
  // Add variant information if we have multiple recipes
  if (recipeGroup.length > 1 && context.combineSimilarNodes) {
    craftNode.resultVariants = recipeGroup.map(entry => entry.itemName);
    craftNode.ingredientVariants = recipeGroup.map(entry => {
      const counts = getIngredientCounts(entry.recipe);
      return Array.from(counts.entries())
        .sort(([a], [b]) => a - b)
        .map(([id, _count]) => mcData.items[id]?.name);
    });
    craftNode.variantMode = 'one_of';
  }

  const recipeInv = new Map(invMap);
  let recipeFeasible = true;

  // Sort ingredients by missing amount (prefer satisfying what we have first)
  const plannedOrder = Array.from(ingredientCounts.entries())
    .map(([ingredientId, count]) => {
      const ingredientItem = mcData.items[ingredientId];
      const ingNameAlloc = ingredientItem ? ingredientItem.name : null;
      const totalNeeded = count * craftingsNeeded;
      const haveIngSnapshot = invMap ? (invMap.get(ingNameAlloc!) || 0) : 0;
      const missingSnapshot = Math.max(0, totalNeeded - haveIngSnapshot);
      return { ingredientId, count, missingSnapshot, totalNeeded, ingNameAlloc };
    })
    .sort((a, b) => a.missingSnapshot - b.missingSnapshot || a.totalNeeded - b.totalNeeded);

  // Process each ingredient
  for (const { ingredientId, ingNameAlloc, totalNeeded } of plannedOrder) {
    const ingredientItem = mcData.items[ingredientId];
    if (!ingredientItem || !ingNameAlloc) continue;

    // Deduct from inventory
    const haveIng = recipeInv.get(ingNameAlloc) || 0;
    const take = Math.min(haveIng, totalNeeded);
    if (take > 0) {
      recipeInv.set(ingNameAlloc, haveIng - take);
    }
    const neededAfterInv = totalNeeded - take;

    if (neededAfterInv <= 0) continue;

    // Handle circular dependencies with mining
    if (hasCircularDependency(mcData, recipeGroup[0].itemId, ingredientId)) {
      const sources = findBlocksThatDrop(mcData, ingredientItem.name);
      if (sources.length > 0) {
        const neededCount = neededAfterInv;

        // World pruning
        if (context.worldBudget) {
          const wb = createWorldBudgetAccessors(context.worldBudget);
          const sourceNames = sources.map(s => s.block);
          const totalAvail = wb.sum('blocks', sourceNames);
          if (!(totalAvail >= neededCount)) {
            recipeFeasible = false;
            break;
          }
        }

        // Create mining group for circular dependency
        const miningGroup = createMiningGroupForCircularDependency(
          mcData,
          ingredientItem.name,
          neededCount,
          sources,
          context
        );
        
        if (miningGroup) {
          craftNode.children.push(miningGroup);
        } else {
          recipeFeasible = false;
          break;
        }
      } else {
        recipeFeasible = false;
        break;
      }
    } else {
      // Recursive call for ingredient
      const nextVisited = new Set(visited);
      nextVisited.add(ingNameAlloc);
      
      const ingredientTree = buildRecipeTreeInternal(
        mcData,
        ingNameAlloc,
        neededAfterInv,
        {
          ...context,
          visited: nextVisited,
          inventory: Object.fromEntries(recipeInv)
        }
      );
      
      craftNode.children.push(ingredientTree);
    }
  }

  return recipeFeasible ? craftNode : null;
}

/**
 * Creates a mining group for handling circular dependencies
 * 
 * @param mcData - Minecraft data object
 * @param itemName - Name of the item to mine
 * @param neededCount - Number of items needed
 * @param sources - Available block sources
 * @param context - Build context
 * @returns Mining group node or null if infeasible
 */
function createMiningGroupForCircularDependency(
  _mcData: MinecraftData,
  itemName: string,
  neededCount: number,
  sources: Array<{block: string, tool: string}>,
  _context: BuildContext
): any | null {
  // This is a simplified version - the full implementation would create
  // a proper MineGroupNode with MineLeafNode children
  // For now, return a placeholder that indicates mining is needed
  
  if (sources.length === 0) return null;
  
  // Find the best tool for mining
  const toolName = chooseMinimalToolName(
    sources.flatMap(s => s.tool === 'any' ? [] : s.tool.split('/'))
  );
  
  return {
    action: 'mine',
    operator: 'OR',
    what: itemName,
    count: neededCount,
    tool: toolName || 'any',
    children: sources.map(source => ({
      action: 'mine',
      operator: 'AND',
      what: source.block,
      count: neededCount,
      tool: source.tool === 'any' ? (toolName || 'any') : source.tool,
      targetItem: itemName
    }))
  };
}
