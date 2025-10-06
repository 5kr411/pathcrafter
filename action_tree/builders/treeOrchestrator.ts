/**
 * Tree orchestrator
 * 
 * Handles the main orchestration logic for recipe tree construction.
 * This includes the main buildRecipeTree function and internal orchestration.
 */

import { 
  RootNode, 
  BuildContext, 
  CraftNode, 
  MineGroupNode, 
  MineLeafNode, 
  SmeltGroupNode, 
  SmeltNode, 
  HuntGroupNode, 
  HuntLeafNode, 
  RequireNode,
  MinecraftRecipe,
  TreeNode,
  BlockSource
} from '../types';
import { resolveMcData } from '../utils/mcDataResolver';
import { findSimilarItems } from '../utils/itemSimilarity';
import { createInventoryMap } from './inventoryManager';
import { filterVariantsByWorldAvailability, fixCraftNodePrimaryFields, normalizePersistentRequires, groupSimilarCraftNodes, groupSimilarMineNodes } from './variantHandler';
import { getIngredientCounts, hasCircularDependency, findFurnaceSmeltsForItem, getRecipeCanonicalKey, requiresCraftingTable } from '../utils/recipeUtils';
import { findBlocksThatDrop, findMobsThatDrop } from '../utils/sourceLookup';
import { chooseMinimalFuelName, getSmeltsPerUnitForFuel } from '../../utils/smeltingConfig';
import { chooseMinimalToolName } from '../../utils/items';
import { mapToInventoryObject } from '../../utils/inventory';
import { createWorldBudgetAccessors } from '../../utils/worldBudget';

/**
 * Main function to build a recipe tree for obtaining a target item
 * 
 * @param ctx - Minecraft data context (version string, mcData object, etc.)
 * @param itemName - Name of the item to obtain
 * @param targetCount - Number of items needed (default: 1)
 * @param context - Build context with configuration
 * @returns Root node of the recipe tree
 */
export function buildRecipeTree(
  ctx: any,
  itemName: string,
  targetCount: number = 1,
  context: BuildContext = {}
): RootNode {
  const mcData = resolveMcData(ctx);
  
  if (!mcData) {
    throw new Error('Could not resolve Minecraft data');
  }
  
  // Always find all similar items (wood families, etc.)
  // This allows exploring all recipe variants for tie-breaking
  const itemGroup = findSimilarItems(mcData, itemName);
  
  // Build for the group
  // When combining is enabled, recipes are grouped and shown with variants
  // When combining is disabled, each recipe becomes a separate branch
  return buildRecipeTreeInternal(ctx, itemGroup, targetCount, context);
}

/**
 * Internal function that builds a recipe tree for a group of similar items
 * 
 * @param ctx - Minecraft data context
 * @param itemGroup - Group of similar items to build tree for
 * @param targetCount - Number of items needed
 * @param context - Build context with configuration
 * @returns Root node of the recipe tree
 */
function buildRecipeTreeInternal(
  ctx: any,
  itemGroup: string[],
  targetCount: number,
  context: BuildContext
): RootNode {
  const mcData = resolveMcData(ctx);
  
  // If familyPrefix is set (combining OFF), filter itemGroup to matching family
  let filteredItemGroup = itemGroup;
  if (context.familyPrefix && !context.combineSimilarNodes && itemGroup.length > 1) {
    filteredItemGroup = itemGroup.filter(name => name.startsWith(context.familyPrefix!));
    if (filteredItemGroup.length === 0) {
      filteredItemGroup = [itemGroup[0]]; // Fallback if no match
    }
  }
  
  const primaryItem = filteredItemGroup[0];
  const item = mcData?.itemsByName[primaryItem];

  const invMap = createInventoryMap(context);

  // Deduct from inventory if available (check all items in group)
  if (invMap && invMap.size > 0 && targetCount > 0) {
    for (const name of filteredItemGroup) {
      const have = invMap.get(name) || 0;
      if (have > 0) {
        const use = Math.min(have, targetCount);
        invMap.set(name, have - use);
        targetCount -= use;
        if (targetCount <= 0) break;
      }
    }
  }

  const root: RootNode = {
    action: 'root',
    operator: 'OR',
    what: primaryItem,
    count: targetCount,
    children: []
  };

  if (!mcData || !item) return root;
  if (targetCount <= 0) return root;

  const avoidTool = context.avoidTool;
  const visited = context.visited instanceof Set ? context.visited : new Set<string>();
  const preferMinimalTools = context.preferMinimalTools !== false;

  // Check if any item in the group has been visited
  const anyVisited = filteredItemGroup.some(name => visited.has(name));
  if (anyVisited) return root;

  const nextVisited = new Set(visited);
  for (const name of filteredItemGroup) {
    nextVisited.add(name);
  }

  // Collect all recipes for all items in the group
  // Don't dedupe yet - we want to group across variants first
  const allRecipes: Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}> = [];
  for (const name of filteredItemGroup) {
    const itemData = mcData.itemsByName[name];
    if (itemData) {
      // Get raw recipes without deduplication
      const rawRecipes = mcData.recipes[itemData.id] || [];
      for (const recipe of rawRecipes) {
        allRecipes.push({recipe, itemName: name, itemId: itemData.id});
      }
    }
  }

  // Group recipes by canonical shape (same structure across different wood types)
  // When combining is disabled, each recipe becomes its own group (separate branches)
  const recipeGroups = new Map<string, Array<{recipe: MinecraftRecipe, itemName: string, itemId: number}>>();
  for (const entry of allRecipes) {
    let key: string;
    if (context.combineSimilarNodes) {
      // Group similar recipes together (e.g., all wood planks recipes)
      key = getRecipeCanonicalKey(entry.recipe);
    } else {
      // Each recipe gets its own unique key based on ingredients (separate branches)
      // Include ingredient IDs to differentiate oak_planks from spruce_planks
      const ingredientCounts = getIngredientCounts(entry.recipe);
      const ingredientKey = Array.from(ingredientCounts.keys()).sort().join(',');
      key = getRecipeCanonicalKey(entry.recipe) + ':' + entry.itemName + ':' + ingredientKey;
    }
    
    if (!recipeGroups.has(key)) {
      recipeGroups.set(key, []);
    }
    recipeGroups.get(key)!.push(entry);
  }

  const worldBudget = (context && context.worldBudget && typeof context.worldBudget === 'object') ? context.worldBudget : undefined;
  const wb = createWorldBudgetAccessors(worldBudget);

  // Process crafting recipe groups (each group represents recipes with same shape across variants)
  for (const [_canonicalKey, recipeGroup] of recipeGroups.entries()) {
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
        return { ingredientId, count, missingSnapshot, totalNeeded };
      })
      .sort((a, b) => a.missingSnapshot - b.missingSnapshot || a.totalNeeded - b.totalNeeded);

    plannedOrder.forEach(({ ingredientId, count }) => {
      const ingredientItem = mcData.items[ingredientId];
      if (!ingredientItem) return;

      const ingNameAlloc = ingredientItem.name;
      const totalNeeded = count * craftingsNeeded;
      let neededAfterInv = totalNeeded;

      // Deduct from recipe inventory
      if (recipeInv && recipeInv.size > 0 && totalNeeded > 0) {
        const haveIng = recipeInv.get(ingNameAlloc);
        if (typeof haveIng === 'number' && haveIng > 0) {
          const take = Math.min(haveIng, totalNeeded);
          recipeInv.set(ingNameAlloc, haveIng - take);
          neededAfterInv -= take;
        }
      }

      if (neededAfterInv <= 0) return;

      // Handle circular dependencies with mining
      if (hasCircularDependency(mcData, item.id, ingredientId)) {
        const sources = findBlocksThatDrop(mcData, ingredientItem.name);
        if (sources.length > 0) {
          const neededCount = neededAfterInv;

          // World pruning
          if (worldBudget) {
            const sourceNames = sources.map(s => s.block);
            const totalAvail = wb.sum('blocks', sourceNames);
            if (!(totalAvail >= neededCount)) {
              recipeFeasible = false;
              return;
            }
          }

          const miningGroup: MineGroupNode = {
            action: 'mine',
            operator: 'OR',
            what: ingredientItem.name,
            count: neededCount,
            children: sources.flatMap(s => {
              if (!s.tool || s.tool === 'any') {
                const leafNode: MineLeafNode = {
                  action: 'mine',
                  what: s.block,
                  targetItem: ingredientItem.name,
                  count: neededCount,
                  children: []
                };
                return [leafNode];
              }

              let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);

              // Prefer existing tools
              const existing = tools.filter(t => {
                if (!invMap) return false;
                const count = invMap.get(t);
                return typeof count === 'number' && count > 0;
              });
              if (existing.length > 0) {
                const chosen = (preferMinimalTools && existing.length > 1) ? chooseMinimalToolName(existing) : existing[0];
                const leafNode: MineLeafNode = {
                  action: 'mine',
                  what: s.block,
                  targetItem: ingredientItem.name,
                  tool: chosen,
                  count: neededCount,
                  children: []
                };
                return [leafNode];
              }

              // Need to craft tools
              const chosen = preferMinimalTools ? chooseMinimalToolName(tools) : tools[0];
              const leafNode: MineLeafNode = {
                action: 'mine',
                what: s.block,
                targetItem: ingredientItem.name,
                tool: chosen,
                count: neededCount,
                children: []
              };
              return [leafNode];
            })
          };
          craftNode.children.push(miningGroup);
        } else {
          recipeFeasible = false;
          return;
        }
      } else {
        // Recursively build tree for ingredient
        if (context.combineSimilarNodes) {
          // When combining is ON, expand to similar items (e.g., all planks)
          const ingredientTree = buildRecipeTree(ctx, ingNameAlloc, neededAfterInv, {
            ...context,
            visited: nextVisited,
            inventory: mapToInventoryObject(recipeInv), // Pass current inventory state
            worldBudget
          });
          craftNode.children.push(ingredientTree);
        } else {
          // When combining is OFF, use ONLY the specific ingredient (no expansion)
          // This ensures each branch is internally consistent
          const ingredientTree = buildRecipeTreeInternal(ctx, [ingNameAlloc], neededAfterInv, {
            ...context,
            visited: nextVisited,
            inventory: mapToInventoryObject(recipeInv), // Pass current inventory state
            worldBudget
          });
          craftNode.children.push(ingredientTree);
        }
      }
    });

    if (recipeFeasible) {
      root.children.push(craftNode);
    }
  }

  // Process smelting recipes (only for primary item, not all variants)
  const smeltInputs = findFurnaceSmeltsForItem(mcData, primaryItem);
  if (smeltInputs.length > 0) {
    const smeltsNeeded = targetCount;
    const fuelName = chooseMinimalFuelName(mcData) || 'coal';
    const smeltsPerFuel = getSmeltsPerUnitForFuel(fuelName);
    let fuelTotal = Math.ceil(smeltsNeeded / smeltsPerFuel);

    // Deduct existing fuel from inventory
    if (fuelName && invMap && invMap.size > 0 && fuelTotal > 0) {
      const haveFuel = invMap.get(fuelName) || 0;
      if (haveFuel > 0) fuelTotal = Math.max(0, fuelTotal - haveFuel);
    }

    const smeltGroup: SmeltGroupNode = {
      action: 'smelt',
      operator: 'OR',
      what: primaryItem,
      count: targetCount,
      children: smeltInputs.map(inp => {
        let inputNeeded = smeltsNeeded;
        if (invMap && invMap.size > 0 && inputNeeded > 0) {
          const haveInp = invMap.get(inp) || 0;
          if (haveInp > 0) inputNeeded = Math.max(0, inputNeeded - haveInp);
        }

        const children: any[] = [];

        // Require furnace
        if (!(invMap && (invMap.get('furnace') || 0) > 0)) {
          children.push({
            action: 'require',
            operator: 'AND',
            what: 'furnace',
            count: 1,
            children: [
              buildRecipeTreeInternal(ctx, ['furnace'], 1, {
                ...context,
                visited: nextVisited,
                inventory: mapToInventoryObject(invMap),
                worldBudget
              })
            ]
          } as RequireNode);
        }

        // Require fuel
        if (fuelName && fuelTotal > 0) {
          children.push(buildRecipeTreeInternal(ctx, [fuelName], fuelTotal, {
            ...context,
            visited: nextVisited,
            inventory: mapToInventoryObject(invMap),
            worldBudget
          }));
        }

        // Require input
        if (inputNeeded > 0) {
          children.push(buildRecipeTreeInternal(ctx, [inp], inputNeeded, {
            ...context,
            visited: nextVisited,
            inventory: mapToInventoryObject(invMap),
            worldBudget
          }));
        }

        const smeltNode: SmeltNode = {
          action: 'smelt',
          operator: 'AND',
          what: 'furnace',
          count: smeltsNeeded,
          result: {
            item: primaryItem,
            perSmelt: 1
          },
          input: {
            item: inp,
            perSmelt: 1
          },
          fuel: fuelName,
          children
        };

        return smeltNode;
      })
    };

    if (smeltGroup.children.length > 0) {
      root.children.push(smeltGroup);
    }
  }

  // Process mining paths
  let miningPaths: BlockSource[];
  if (filteredItemGroup.length > 1 && context.combineSimilarNodes) {
    // When combining is enabled, collect mining paths for all items in the group
    const allMiningPaths: Array<{path: BlockSource, itemName: string}> = [];
    for (const name of filteredItemGroup) {
      const paths = findBlocksThatDrop(mcData, name);
      for (const path of paths) {
        allMiningPaths.push({path, itemName: name});
      }
    }
    
    // Group all mining paths together (don't split by suffix)
    // This creates ONE mine path entry with all block and target variants
    const allBlocks = Array.from(new Set(allMiningPaths.map(p => p.path.block)));
    const allTargets = Array.from(new Set(allMiningPaths.map(p => p.itemName)));
    const firstPath = allMiningPaths[0].path;
    
    miningPaths = [{
      ...firstPath,
      _blockVariants: allBlocks, // All block types
      _targetVariants: allTargets // All target items
    } as any];
  } else {
    // When combining is disabled, use only paths for the primary item
    // This ensures each branch is internally consistent
    miningPaths = findBlocksThatDrop(mcData, primaryItem);
  }
  
  if (miningPaths.length > 0) {

    const mineGroup: MineGroupNode = {
      action: 'mine',
      operator: 'OR',
      what: primaryItem,
      count: targetCount,
      children: miningPaths.flatMap(s => {
        if (!s.tool || s.tool === 'any') {
          if (!wb.can('blocks', s.block, targetCount)) return [];
          const leafNode: MineLeafNode = {
            action: 'mine',
            what: s.block,
            targetItem: primaryItem,
            count: targetCount,
            children: []
          };
          
          // Add variant information if available
          if ((s as any)._blockVariants && context.combineSimilarNodes) {
            const blockVariants = (s as any)._blockVariants;
            const targetVariants = (s as any)._targetVariants || [primaryItem];
            if (blockVariants.length > 1) {
              leafNode.whatVariants = blockVariants; // All block types
              leafNode.targetItemVariants = targetVariants; // The items they drop
              leafNode.variantMode = 'one_of';
            }
          }
          
          return [leafNode];
        }

        let tools = String(s.tool).split('/').filter(Boolean).filter(t => !avoidTool || t !== avoidTool);

        // Prefer existing tools
        const existing = tools.filter(t => {
          if (!invMap) return false;
          const count = invMap.get(t);
          return typeof count === 'number' && count > 0;
        });
        if (existing.length > 0) {
          const chosen = (preferMinimalTools && existing.length > 1) ? chooseMinimalToolName(existing) : existing[0];
          if (!wb.can('blocks', s.block, targetCount)) return [];
          const leafNode: MineLeafNode = {
            action: 'mine',
            what: s.block,
            targetItem: primaryItem,
            tool: chosen,
            count: targetCount,
            children: []
          };
          
          // Add variant information if available
          if ((s as any)._blockVariants && context.combineSimilarNodes) {
            const blockVariants = (s as any)._blockVariants;
            const targetVariants = (s as any)._targetVariants || [primaryItem];
            if (blockVariants.length > 1) {
              leafNode.whatVariants = blockVariants;
              leafNode.targetItemVariants = targetVariants;
              leafNode.variantMode = 'one_of';
            }
          }
          
          return [leafNode];
        }

        // Need to craft tools
        const chosen = preferMinimalTools ? chooseMinimalToolName(tools) : tools[0];
        if (!wb.can('blocks', s.block, targetCount)) return [];
        
        const leafNode: MineLeafNode = {
          action: 'mine',
          what: s.block,
          targetItem: primaryItem,
          tool: chosen,
          count: targetCount,
          children: []
        };
        
        // Add variant information if available
        if ((s as any)._blockVariants && context.combineSimilarNodes) {
          const blockVariants = (s as any)._blockVariants;
          const targetVariants = (s as any)._targetVariants || [primaryItem];
          if (blockVariants.length > 1) {
            leafNode.whatVariants = blockVariants;
            leafNode.targetItemVariants = targetVariants;
            leafNode.variantMode = 'one_of';
          }
        }
        
        return [leafNode];
      })
    };

    // Only add mine group if it has valid children
    if (mineGroup.children.length > 0) {
      root.children.push(mineGroup);
    }
  }

  // Process hunting paths (only for primary item, not all variants)
  const huntingPaths = findMobsThatDrop(mcData, primaryItem);
  if (huntingPaths.length > 0) {
    const huntGroup: HuntGroupNode = {
      action: 'hunt',
      operator: 'OR',
      what: primaryItem,
      count: targetCount,
      children: huntingPaths.map(s => {
        const p = s.dropChance && s.dropChance > 0 ? s.dropChance : 1;
        const expectedKills = Math.ceil(targetCount / p);

        if (!wb.can('entities', s.mob, expectedKills)) return null;

        const huntLeaf: HuntLeafNode = {
          action: 'hunt',
          what: s.mob,
          targetItem: primaryItem,
          count: expectedKills,
          dropChance: s.dropChance,
          children: []
        };
        return huntLeaf;
      }).filter((n): n is HuntLeafNode => n !== null)
    };

    // Only add hunt group if it has valid children
    if (huntGroup.children.length > 0) {
      root.children.push(huntGroup);
    }
  }

  // Normalize persistent requirements
  try {
    normalizePersistentRequires(root, context && context.inventory ? context.inventory : null);
  } catch (_) {
    // Ignore normalization errors
  }

  // Filter variants based on world availability if enabled
  if (context && context.combineSimilarNodes && worldBudget) {
    try {
      filterVariantsByWorldAvailability(root, worldBudget);
      // After filtering, fix craft nodes to use available variants as primary
      fixCraftNodePrimaryFields(root, worldBudget);
    } catch (_) {
      // Ignore filtering errors
    }
  }

  // Apply variant combining if enabled
  if (context.combineSimilarNodes) {
    combineSimilarNodesInTree(mcData, root);
  }

  return root;
}

/**
 * Recursively combines similar nodes throughout the tree
 */
function combineSimilarNodesInTree(mcData: any, node: TreeNode): void {
  if (!node || !node.children || node.children.length === 0) return;

  // Recurse first
  for (const child of node.children) {
    combineSimilarNodesInTree(mcData, child);
  }

  // Then combine at this level
  if (node.action === 'root') {
    // Combine craft nodes at root level
    node.children = groupSimilarCraftNodes(mcData, node.children);
  } else if (node.action === 'mine' && 'operator' in node && node.operator === 'OR') {
    // Group mine leaf nodes within mine groups
    node.children = groupSimilarMineNodes(mcData, node.children);
  } else if (node.action === 'craft') {
    // Combine child mine groups
    node.children = node.children.map(child => {
      if (child.action === 'mine' && 'operator' in child && child.operator === 'OR') {
        child.children = groupSimilarMineNodes(mcData, child.children);
      }
      return child;
    });
  }
}

/**
 * Sets up the buildRecipeTreeInternal reference for circular dependency resolution
 * This is needed because craftNodeBuilder needs to call back to the main orchestrator
 */
export function setupCircularDependencyResolution(): void {
  // This function will be called during initialization to set up the circular dependency
  // The actual implementation would involve passing the buildRecipeTreeInternal function
  // to the craftNodeBuilder module
}